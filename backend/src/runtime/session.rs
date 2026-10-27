use std::io::Read;
use std::sync::{Arc, Mutex};
use serde_json::{json, Value};

use super::*;

pub fn reader_loop(mut reader: Box<dyn Read + Send>, output: Arc<Mutex<OutputBuffer>>) {
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let Ok(mut shared) = output.lock() else {
                    return;
                };
                shared.push(&buffer[..read]);
            }
            Err(_) => break,
        }
    }
    if let Ok(mut shared) = output.lock() {
        shared.reader_done = true;
    }
}

pub fn respond(backend: &mut Backend, line: &str) -> Option<String> {
    if line.trim().is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            return Some(error_frame(
                Value::Null,
                -32700,
                format!("the request line is not JSON: {error}"),
            ))
        }
    };
    let Some(object) = value.as_object() else {
        return Some(error_frame(
            Value::Null,
            -32600,
            "a JSON-RPC request is an object".to_string(),
        ));
    };
    let params = object.get("params").cloned().unwrap_or(Value::Null);
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    let Some(id) = object.get("id").cloned() else {
        return None;
    };
    if method.is_empty() {
        return Some(error_frame(
            id,
            -32600,
            "the request names no method".to_string(),
        ));
    }

    Some(match backend.handle(&method, &params) {
        Ok(result) => result_frame(id, result),
        Err(error) => error_frame(id, error.code, error.message),
    })
}

pub fn result_frame(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

pub fn error_frame(id: Value, code: i64, message: String) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

pub fn required_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, RpcError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_params(format!("'{key}' must be a non-empty string")))
}

pub fn optional_str<'a>(params: &'a Value, key: &str) -> Result<Option<&'a str>, RpcError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.as_str())),
        Some(_) => Err(invalid_params(format!("'{key}' must be a string"))),
    }
}

pub fn optional_usize(params: &Value, key: &str, default: usize) -> Result<usize, RpcError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(value) => value
            .as_u64()
            .map(|number| number as usize)
            .ok_or_else(|| invalid_params(format!("'{key}' must be a positive integer"))),
    }
}

pub fn optional_dim(params: &Value, key: &str, default: u16, max: u16) -> Result<u16, RpcError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(value) => {
            let number = value
                .as_u64()
                .ok_or_else(|| invalid_params(format!("'{key}' must be a positive integer")))?;
            if number == 0 || number > u64::from(max) {
                return Err(invalid_params(format!(
                    "'{key}' must be between 1 and {max}"
                )));
            }
            Ok(number as u16)
        }
    }
}

pub fn required_dim(params: &Value, key: &str, max: u16) -> Result<u16, RpcError> {
    let number = params
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid_params(format!("'{key}' must be a positive integer")))?;
    if number == 0 || number > u64::from(max) {
        return Err(invalid_params(format!(
            "'{key}' must be between 1 and {max}"
        )));
    }
    Ok(number as u16)
}
