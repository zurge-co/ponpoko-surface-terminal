use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::{json, Value};

use super::*;

use std::time::{Duration, Instant};

pub fn exchange(backend: &mut Backend, method: &str, params: Value) -> Value {
    let line = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    })
    .to_string();
    let response = respond(backend, &line).expect("a request gets an answer");
    serde_json::from_str(&response).expect("the answer is JSON")
}

pub fn close(backend: &mut Backend, id: &str) {
    let answer = exchange(backend, "term.close", json!({ "id": id }));
    assert_eq!(answer["result"]["ok"], true);
}

#[test]
pub fn the_method_table_is_what_the_manifest_declares_and_this_crate_dispatches() {
    let manifest = include_str!("../../../surface.json");
    for method in METHODS {
        assert!(
            manifest.contains(&format!("\"{method}\"")),
            "{method} is not declared in surface.json"
        );
        let refused = Backend::new().handle(method, &Value::Null).err();
        assert_ne!(
            refused.map(|error| error.code),
            Some(-32601),
            "{method} is in METHODS but has no dispatch"
        );
    }
}

#[test]
pub fn a_request_is_answered_with_its_own_id_and_a_result_or_an_error() {
    let mut backend = Backend::new();
    let answer = exchange(&mut backend, "app.ping", json!({}));
    assert_eq!(answer["jsonrpc"], "2.0");
    assert_eq!(answer["id"], 1);
    assert_eq!(answer["result"]["ok"], true);
    assert!(answer["result"]["pid"].as_u64().unwrap_or(0) > 0);
    assert!(answer.get("error").is_none());

    let answer = exchange(&mut backend, "term.nope", json!({}));
    assert_eq!(answer["id"], 1);
    assert_eq!(answer["error"]["code"], -32601);
    assert!(answer["error"]["message"]
        .as_str()
        .expect("a message")
        .contains("term.nope"));
}

#[test]
pub fn app_info_names_the_terminal_and_the_shell_it_would_start() {
    let mut backend = Backend::new();
    let answer = exchange(&mut backend, "app.info", json!({}));
    assert_eq!(answer["result"]["name"], "terminal");
    assert_eq!(answer["result"]["version"], env!("CARGO_PKG_VERSION"));
    #[cfg(unix)]
    assert!(answer["result"]["default_shell"].as_str().is_some());
}

#[cfg(unix)]
#[test]
pub fn opening_a_shell_returns_a_real_pty_and_list_reports_it() {
    let mut backend = Backend::new();
    let opened = exchange(
        &mut backend,
        "term.open",
        json!({ "shell": "/bin/sh", "cols": 100, "rows": 30 }),
    );
    let id = opened["result"]["id"]
        .as_str()
        .expect("a session id")
        .to_string();
    assert!(opened["result"]["pid"].as_u64().unwrap_or(0) > 0);
    assert_eq!(opened["result"]["shell"], "/bin/sh");
    assert_eq!(opened["result"]["cols"], 100);
    assert_eq!(opened["result"]["rows"], 30);

    let listed = exchange(&mut backend, "term.list", json!({}));
    let sessions = listed["result"]["sessions"].as_array().expect("sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], id);
    assert_eq!(sessions[0]["shell"], "/bin/sh");
    assert_eq!(sessions[0]["exited"], false);

    close(&mut backend, &id);
    let listed = exchange(&mut backend, "term.list", json!({}));
    assert_eq!(
        listed["result"]["sessions"]
            .as_array()
            .expect("sessions")
            .len(),
        0
    );
}

#[cfg(unix)]
#[test]
pub fn thai_output_survives_the_pty_and_the_exit_status_is_reported() {
    let mut backend = Backend::new();
    let opened = exchange(
        &mut backend,
        "term.open",
        json!({ "shell": "/bin/sh", "cols": 80, "rows": 24 }),
    );
    let id = opened["result"]["id"]
        .as_str()
        .expect("a session id")
        .to_string();

    let command = "printf 'สวัสดี\\n'; exit 7\n";
    let written = exchange(
        &mut backend,
        "term.write",
        json!({ "id": id, "data": BASE64.encode(command.as_bytes()) }),
    );
    assert_eq!(written["result"]["bytes"], command.len());

    let mut output = Vec::new();
    let mut exit = None;
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        let answer = exchange(
            &mut backend,
            "term.poll",
            json!({ "id": id, "max_bytes": 65536 }),
        );
        if let Some(data) = answer["result"]["data"].as_str() {
            output.extend(
                BASE64
                    .decode(data)
                    .expect("the poll answer carries valid base64"),
            );
        }
        if answer["result"]["exited"].as_bool() == Some(true) {
            exit = answer["result"]["exit_code"].as_u64();
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    close(&mut backend, &id);

    let text = String::from_utf8_lossy(&output);
    assert!(
        text.contains("สวัสดี"),
        "Thai bytes survived the PTY read: {text}"
    );
    assert_eq!(exit, Some(7), "the shell's exit status is reported: {text}");
}

#[cfg(unix)]
#[test]
pub fn resize_updates_the_recorded_session_size() {
    let mut backend = Backend::new();
    let opened = exchange(&mut backend, "term.open", json!({ "shell": "/bin/sh" }));
    let id = opened["result"]["id"]
        .as_str()
        .expect("a session id")
        .to_string();
    let resized = exchange(
        &mut backend,
        "term.resize",
        json!({ "id": id, "cols": 120, "rows": 40 }),
    );
    assert_eq!(resized["result"]["cols"], 120);
    assert_eq!(resized["result"]["rows"], 40);

    let listed = exchange(&mut backend, "term.list", json!({}));
    assert_eq!(listed["result"]["sessions"][0]["cols"], 120);
    assert_eq!(listed["result"]["sessions"][0]["rows"], 40);
    close(&mut backend, &id);
}

#[test]
pub fn unknown_sessions_and_invalid_base64_are_sentences_not_crashes() {
    let mut backend = Backend::new();
    let answer = exchange(&mut backend, "term.poll", json!({ "id": "missing" }));
    assert_eq!(answer["error"]["code"], -32000);
    assert!(answer["error"]["message"]
        .as_str()
        .expect("a message")
        .contains("not open"));

    let answer = exchange(
        &mut backend,
        "term.write",
        json!({ "id": "missing", "data": "%%% not base64 %%%" }),
    );
    assert_eq!(answer["error"]["code"], -32602);
    assert!(answer["error"]["message"]
        .as_str()
        .expect("a message")
        .contains("base64"));

    let answer = exchange(&mut backend, "term.close", json!({ "id": "missing" }));
    assert_eq!(answer["result"]["closed"], false);
}

#[test]
pub fn the_output_buffer_drops_the_oldest_bytes_and_reports_once() {
    let mut buffer = OutputBuffer {
        cap: 8,
        ..OutputBuffer::default()
    };
    buffer.push(b"abcdefghij");
    assert!(buffer.reader_done == false);

    let (data, dropped) = buffer.drain(4);
    assert_eq!(dropped, 2);
    assert_eq!(data, b"cdef");
    assert_eq!(buffer.bytes.len(), 4);

    let (data, dropped) = buffer.drain(64);
    assert_eq!(dropped, 0);
    assert_eq!(data, b"ghij");
}

#[cfg(unix)]
#[test]
pub fn a_session_remembers_which_page_opened_it_and_list_reports_that_page() {
    let mut backend = Backend::new();
    let owned = exchange(
        &mut backend,
        "term.open",
        json!({ "shell": "/bin/sh", "client": "page-a" }),
    );
    let owned = owned["result"]["id"].as_str().expect("an id").to_string();
    let anonymous = exchange(&mut backend, "term.open", json!({ "shell": "/bin/sh" }));
    assert!(anonymous["result"]["id"].as_str().is_some());

    let listed = exchange(&mut backend, "term.list", json!({}));
    assert_eq!(listed["result"]["limit"], MAX_SESSIONS);
    let sessions = listed["result"]["sessions"].as_array().expect("sessions");
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0]["id"], owned.as_str());
    assert_eq!(sessions[0]["client"], "page-a");
    assert!(sessions[1]["client"].is_null());
    for session in sessions {
        assert!(session["idle_ms"].as_u64().is_some(), "idle_ms is a number");
    }
    close(&mut backend, &owned);
}

#[cfg(unix)]
#[test]
pub fn a_session_nobody_polls_is_swept_and_frees_its_slot() {
    let mut backend = Backend::new();
    let ids: Vec<String> = (0..MAX_SESSIONS)
        .map(|_| {
            let opened = exchange(&mut backend, "term.open", json!({ "shell": "/bin/sh" }));
            opened["result"]["id"].as_str().expect("an id").to_string()
        })
        .collect();
    let refused = exchange(&mut backend, "term.open", json!({ "shell": "/bin/sh" }));
    assert_eq!(refused["error"]["code"], -32000);

    for session in backend.sessions.iter_mut() {
        session.last_seen_ms = 0;
    }
    let swept = backend.sweep_idle(SESSION_IDLE_MS, SESSION_IDLE_MS);
    assert_eq!(swept, ids.len(), "every session past the grace period goes");

    let opened = exchange(
        &mut backend,
        "term.open",
        json!({ "shell": "/bin/sh", "client": "page-b" }),
    );
    let fresh = opened["result"]["id"].as_str().expect("an id").to_string();
    let listed = exchange(&mut backend, "term.list", json!({}));
    let remaining = listed["result"]["sessions"].as_array().expect("sessions");
    assert_eq!(remaining.len(), 1, "the sweeping left room for the new shell");
    assert_eq!(remaining[0]["id"], fresh.as_str());
    close(&mut backend, &fresh);
}

#[cfg(unix)]
#[test]
pub fn an_open_at_the_limit_sweeps_the_silent_shells_instead_of_refusing() {
    let mut backend = Backend::new();
    for _ in 0..MAX_SESSIONS {
        let opened = exchange(
            &mut backend,
            "term.open",
            json!({ "shell": "/bin/sh", "client": "page-gone" }),
        );
        assert!(opened["result"]["id"].as_str().is_some());
    }
    for session in backend.sessions.iter_mut() {
        session.last_seen_ms = 0;
    }

    let opened = exchange(
        &mut backend,
        "term.open",
        json!({ "shell": "/bin/sh", "client": "page-new" }),
    );
    assert!(opened.get("error").is_none(), "the open swept and then opened");
    let listed = exchange(&mut backend, "term.list", json!({}));
    let sessions = listed["result"]["sessions"].as_array().expect("sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["client"], "page-new");
    close(
        &mut backend,
        sessions[0]["id"].as_str().expect("an id"),
    );
}

#[test]
pub fn the_idle_grace_period_can_be_shortened_by_the_environment_and_never_becomes_zero() {
    let read = |value: &str| {
        std::env::set_var("PONPOKO_TERMINAL_IDLE_MS", value);
        session_idle_ms()
    };
    let shortened = read("1500");
    let floor = read("0");
    let garbled = read("not a number");
    std::env::remove_var("PONPOKO_TERMINAL_IDLE_MS");
    let unset = session_idle_ms();

    assert_eq!(shortened, 1500);
    assert_eq!(floor, SESSION_IDLE_MS, "zero would mean sweeping live shells");
    assert_eq!(garbled, SESSION_IDLE_MS);
    assert_eq!(unset, SESSION_IDLE_MS);
}

#[cfg(unix)]
#[test]
pub fn a_polled_session_outlives_the_grace_period_and_an_idle_one_does_not() {
    let mut backend = Backend::new();
    let live = exchange(&mut backend, "term.open", json!({ "shell": "/bin/sh" }));
    let live = live["result"]["id"].as_str().expect("an id").to_string();
    let stale = exchange(&mut backend, "term.open", json!({ "shell": "/bin/sh" }));
    let stale = stale["result"]["id"].as_str().expect("an id").to_string();
    for session in backend.sessions.iter_mut() {
        if session.id == stale {
            session.last_seen_ms = 0;
        }
    }
    exchange(&mut backend, "term.poll", json!({ "id": live, "max_bytes": 1024 }));

    assert_eq!(
        backend.sweep_idle(now_ms(), SESSION_IDLE_MS),
        1,
        "only the silent session is closed"
    );
    let listed = exchange(&mut backend, "term.list", json!({}));
    let remaining = listed["result"]["sessions"].as_array().expect("sessions");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0]["id"], live.as_str());
    assert!(remaining[0]["idle_ms"].as_u64().unwrap_or(u64::MAX) < SESSION_IDLE_MS);
    close(&mut backend, &live);
}

#[test]
pub fn a_missing_cwd_falls_back_to_home_instead_of_failing_the_shell() {
    if let Some(home) = home_dir() {
        assert_eq!(resolve_cwd(Some("/ponpoko/definitely/not/a/directory")), home);
    }
}

#[cfg(unix)]
#[test]
pub fn the_default_shell_is_an_executable_on_this_machine() {
    let shell = default_shell().expect("a shell");
    assert!(shell.is_file(), "{} should be a file", shell.display());
}
