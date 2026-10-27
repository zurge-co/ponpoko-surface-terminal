use std::collections::VecDeque;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use portable_pty::{Child, MasterPty};



pub const MAX_SESSIONS: usize = 8;

pub const MAX_WRITE_BYTES: usize = 64 * 1024;

pub const MAX_POLL_BYTES: usize = 256 * 1024;

pub const OUTPUT_CAP_BYTES: usize = 4 * 1024 * 1024;

pub const DEFAULT_POLL_BYTES: usize = 64 * 1024;
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;
pub const MAX_COLS: u16 = 500;
pub const MAX_ROWS: u16 = 200;

pub const METHODS: [&str; 8] = [
    "term.open",
    "term.write",
    "term.poll",
    "term.resize",
    "term.close",
    "term.list",
    "app.ping",
    "app.info",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

pub(crate) fn invalid_params(message: impl Into<String>) -> RpcError {
    RpcError {
        code: -32602,
        message: message.into(),
    }
}

pub(crate) fn failure(message: impl Into<String>) -> RpcError {
    RpcError {
        code: -32000,
        message: message.into(),
    }
}

pub fn unknown_method(method: &str) -> RpcError {
    RpcError {
        code: -32601,
        message: format!(
            "'{method}' is not a method this backend has ({})",
            METHODS.join(" | ")
        ),
    }
}

pub struct OutputBuffer {
    bytes: VecDeque<u8>,
    dropped: u64,
    reader_done: bool,
    cap: usize,
}

impl Default for OutputBuffer {
    fn default() -> Self {
        OutputBuffer {
            bytes: VecDeque::new(),
            dropped: 0,
            reader_done: false,
            cap: OUTPUT_CAP_BYTES,
        }
    }
}

impl OutputBuffer {
    pub fn push(&mut self, chunk: &[u8]) {
        for byte in chunk {
            self.bytes.push_back(*byte);
        }
        while self.bytes.len() > self.cap {
            let excess = self.bytes.len() - self.cap;
            self.bytes.drain(..excess);
            self.dropped += excess as u64;
        }
    }

    pub fn drain(&mut self, max: usize) -> (Vec<u8>, u64) {
        let take = max.min(self.bytes.len());
        let data: Vec<u8> = self.bytes.drain(..take).collect();
        let dropped = self.dropped;
        self.dropped = 0;
        (data, dropped)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitInfo {
    code: u32,
    signal: Option<String>,
}

pub struct Session {
    id: String,
    shell: String,
    cwd: PathBuf,
    cols: u16,
    rows: u16,
    master: Box<dyn MasterPty>,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    output: Arc<Mutex<OutputBuffer>>,
    exit: Option<ExitInfo>,
    exit_reported: bool,
    created_ms: u64,
}

mod backend;
mod session;
mod platform;

pub use backend::*;
pub use session::*;
pub use platform::*;

#[cfg(test)]
#[path = "tests.rs"]

#[cfg(test)]
mod tests;
