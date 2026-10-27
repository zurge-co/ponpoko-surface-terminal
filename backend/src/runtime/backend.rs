use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::{json, Value};

use super::*;

pub struct Backend {
    sessions: Vec<Session>,
    next_id: u64,
}

impl Default for Backend {
    fn default() -> Self {
        Self::new()
    }
}

impl Backend {
    pub fn new() -> Self {
        Backend {
            sessions: Vec::new(),
            next_id: 0,
        }
    }

    pub fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "app.ping" => Ok(json!({ "ok": true, "pid": std::process::id() })),
            "app.info" => Ok(json!({
                "name": "terminal",
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "default_shell": default_shell().map(|path| path.display().to_string()),
            })),

            "term.open" => self.open(params),
            "term.write" => self.write(params),
            "term.poll" => self.poll(params),
            "term.resize" => self.resize(params),
            "term.close" => self.close(params),
            "term.list" => Ok(self.list()),

            other => Err(unknown_method(other)),
        }
    }

    pub fn open(&mut self, params: &Value) -> Result<Value, RpcError> {
        if self.sessions.len() >= MAX_SESSIONS {
            return Err(failure(format!(
                "this terminal already has {MAX_SESSIONS} shells open (the limit) — close one before opening another"
            )));
        }

        let requested = optional_str(params, "shell")?.and_then(|shell| {
            let trimmed = shell.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        });
        let shell = match requested {
            Some(requested) => {
                let path = PathBuf::from(requested);
                if !shell_exists(&path) {
                    return Err(invalid_params(format!(
                        "the shell '{}' does not exist or is not a file",
                        path.display()
                    )));
                }
                path
            }
            None => default_shell().ok_or_else(|| {
                failure("no usable shell was found ($SHELL, /bin/zsh, /bin/bash, /bin/sh)")
            })?,
        };

        let cwd = resolve_cwd(optional_str(params, "cwd")?);
        let cols = optional_dim(params, "cols", DEFAULT_COLS, MAX_COLS)?;
        let rows = optional_dim(params, "rows", DEFAULT_ROWS, MAX_ROWS)?;

        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| failure(format!("the PTY could not be opened: {error}")))?;
        let portable_pty::PtyPair { slave, master } = pair;

        let mut command = CommandBuilder::new(&shell);
        command.cwd(&cwd);
        if let Some(flag) = login_flag(&shell) {
            command.arg(flag);
        }
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "ponpoko");
        command.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

        let child = slave.spawn_command(command).map_err(|error| {
            failure(format!(
                "the shell '{}' could not be started: {error}",
                shell.display()
            ))
        })?;
        drop(slave);

        let writer = master
            .take_writer()
            .map_err(|error| failure(format!("the shell's input could not be opened: {error}")))?;
        let reader = master
            .try_clone_reader()
            .map_err(|error| failure(format!("the shell's output could not be opened: {error}")))?;

        self.next_id += 1;
        let id = format!("t{}", self.next_id);
        let output = Arc::new(Mutex::new(OutputBuffer::default()));
        let reader_output = Arc::clone(&output);
        std::thread::Builder::new()
            .name(format!("terminal-pty-{id}"))
            .spawn(move || reader_loop(reader, reader_output))
            .map_err(|error| {
                failure(format!("the shell's reader could not be started: {error}"))
            })?;

        let pid = child.process_id().unwrap_or(0);
        let session = Session {
            id: id.clone(),
            shell: shell.display().to_string(),
            cwd: cwd.clone(),
            cols,
            rows,
            master,
            child,
            writer,
            output,
            exit: None,
            exit_reported: false,
            created_ms: now_ms(),
        };
        self.sessions.push(session);

        Ok(json!({
            "id": id,
            "pid": pid,
            "shell": shell.display().to_string(),
            "cwd": cwd.display().to_string(),
            "cols": cols,
            "rows": rows,
        }))
    }

    pub fn write(&mut self, params: &Value) -> Result<Value, RpcError> {
        let id = required_str(params, "id")?;
        let data = required_str(params, "data")?;
        let bytes = BASE64
            .decode(data.trim())
            .map_err(|_| invalid_params("the input is not valid base64"))?;
        if bytes.len() > MAX_WRITE_BYTES {
            return Err(invalid_params(format!(
                "one write may carry at most {MAX_WRITE_BYTES} bytes"
            )));
        }
        let session = self.session_mut(id)?;
        session
            .writer
            .write_all(&bytes)
            .and_then(|()| session.writer.flush())
            .map_err(|error| failure(format!("the shell's input closed: {error}")))?;
        Ok(json!({ "ok": true, "bytes": bytes.len() }))
    }

    pub fn poll(&mut self, params: &Value) -> Result<Value, RpcError> {
        let id = required_str(params, "id")?;
        let max = optional_usize(params, "max_bytes", DEFAULT_POLL_BYTES)?.clamp(1, MAX_POLL_BYTES);
        let session = self.session_mut(id)?;

        let (data, dropped, reader_done) = {
            let mut buffer = session
                .output
                .lock()
                .map_err(|_| failure("the terminal output buffer was poisoned"))?;
            let (data, dropped) = buffer.drain(max);
            (data, dropped, buffer.reader_done)
        };

        if session.exit.is_none() {
            match session.child.try_wait() {
                Ok(Some(status)) => {
                    session.exit = Some(ExitInfo {
                        code: status.exit_code(),
                        signal: status.signal().map(str::to_string),
                    });
                }
                Ok(None) => {}
                Err(error) => {
                    return Err(failure(format!(
                        "the shell's exit status could not be read: {error}"
                    )))
                }
            }
        }

        let report_exit = session.exit.is_some() && (reader_done || session.exit_reported);
        if session.exit.is_some() {
            session.exit_reported = true;
        }

        let mut answer = json!({
            "data": BASE64.encode(&data),
            "bytes": data.len(),
            "dropped": dropped,
            "exited": report_exit,
            "reader_done": reader_done,
        });
        if report_exit {
            if let Some(exit) = &session.exit {
                answer["exit_code"] = json!(exit.code);
                answer["signal"] = json!(exit.signal.as_deref());
            }
        }
        Ok(answer)
    }

    pub fn resize(&mut self, params: &Value) -> Result<Value, RpcError> {
        let id = required_str(params, "id")?;
        let cols = required_dim(params, "cols", MAX_COLS)?;
        let rows = required_dim(params, "rows", MAX_ROWS)?;
        let session = self.session_mut(id)?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| failure(format!("the terminal could not be resized: {error}")))?;
        session.cols = cols;
        session.rows = rows;
        Ok(json!({ "ok": true, "cols": cols, "rows": rows }))
    }

    pub fn close(&mut self, params: &Value) -> Result<Value, RpcError> {
        let id = required_str(params, "id")?;
        let Some(index) = self.sessions.iter().position(|session| session.id == id) else {
            return Ok(json!({ "ok": true, "closed": false }));
        };
        let mut session = self.sessions.remove(index);
        let _ = session.child.kill();
        Ok(json!({ "ok": true, "closed": true }))
    }

    pub fn list(&self) -> Value {
        let sessions: Vec<Value> = self
            .sessions
            .iter()
            .map(|session| {
                json!({
                    "id": session.id,
                    "pid": session.child.process_id().unwrap_or(0),
                    "shell": session.shell,
                    "cwd": session.cwd.display().to_string(),
                    "cols": session.cols,
                    "rows": session.rows,
                    "exited": session.exit.is_some(),
                    "exit_code": session.exit.as_ref().map(|exit| exit.code),
                    "signal": session.exit.as_ref().and_then(|exit| exit.signal.clone()),
                    "created_ms": session.created_ms,
                })
            })
            .collect();
        json!({ "sessions": sessions })
    }

    pub fn session_mut(&mut self, id: &str) -> Result<&mut Session, RpcError> {
        self.sessions
            .iter_mut()
            .find(|session| session.id == id)
            .ok_or_else(|| failure(format!("the terminal session '{id}' is not open")))
    }

    pub fn shutdown(&mut self) {
        for mut session in std::mem::take(&mut self.sessions) {
            let _ = session.child.kill();
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.shutdown();
    }
}
