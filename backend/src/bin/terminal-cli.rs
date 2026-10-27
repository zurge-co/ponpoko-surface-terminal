use std::io::{BufRead, Read};

use serde_json::{json, Map, Value};
use terminal_backend::{Backend, METHODS, RpcError};

const USAGE: &str = "\
terminal-cli — the terminal surface's own command line

USAGE:
    terminal-cli --list
    terminal-cli --help
    terminal-cli <method> [key=value ...]
    terminal-cli <method> --json '<params object>'
    terminal-cli <method> --json -        (params read from stdin)
    terminal-cli --batch                  (one call per stdin line)

EXAMPLES:
    terminal-cli app.info
    terminal-cli term.list
    terminal-cli term.open shell=/bin/sh
    echo '{\"shell\":\"/bin/sh\",\"cols\":100}' | terminal-cli term.open --json -

Values given as key=value are taken as JSON when they parse as JSON
(true, false, null, numbers, objects, arrays) and as text otherwise.
Shells live as long as this process: use --batch to drive one across calls.";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{USAGE}");
        return;
    }
    if args[0] == "--list" {
        for method in METHODS {
            println!("{method}");
        }
        return;
    }

    let mut backend = Backend::new();
    let outcome = if args[0] == "--batch" {
        batch(&mut backend)
    } else {
        single(&mut backend, &args)
    };
    backend.shutdown();
    if let Err(message) = outcome {
        eprintln!("terminal-cli: {message}");
        std::process::exit(2);
    }
}

fn single(backend: &mut Backend, args: &[String]) -> Result<(), String> {
    let (method, params) = parse(args)?;
    match backend.handle(&method, &params) {
        Ok(result) => {
            println!("{}", pretty(&result));
            Ok(())
        }
        Err(RpcError { code, message }) => {
            eprintln!("{}", json!({ "error": { "code": code, "message": message } }));
            std::process::exit(1);
        }
    }
}

fn batch(backend: &mut Backend) -> Result<(), String> {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| format!("stdin could not be read: {e}"))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let words: Vec<String> = line.split_whitespace().map(str::to_string).collect();
        match parse(&words) {
            Ok((method, params)) => match backend.handle(&method, &params) {
                Ok(result) => println!("{}", json!({ "result": result })),
                Err(RpcError { code, message }) => {
                    println!("{}", json!({ "error": { "code": code, "message": message } }))
                }
            },
            Err(message) => println!("{}", json!({ "error": { "code": -32600, "message": message } })),
        }
    }
    Ok(())
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn parse(args: &[String]) -> Result<(String, Value), String> {
    let method = args[0].trim();
    if method.is_empty() || method.starts_with('-') {
        return Err(format!("'{method}' is not a method name"));
    }

    let mut params = Map::new();
    let mut index = 1;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--json" {
            let source = args
                .get(index + 1)
                .ok_or_else(|| "--json needs a params object (or - for stdin)".to_string())?;
            let text = if source == "-" {
                let mut text = String::new();
                std::io::stdin()
                    .read_to_string(&mut text)
                    .map_err(|e| format!("stdin could not be read: {e}"))?;
                text
            } else {
                source.clone()
            };
            let value: Value = serde_json::from_str(&text)
                .map_err(|e| format!("--json '{source}' is not JSON: {e}"))?;
            let object = value
                .as_object()
                .ok_or_else(|| "--json takes a params OBJECT, not a bare value".to_string())?;
            for (key, value) in object {
                params.insert(key.clone(), value.clone());
            }
            index += 2;
            continue;
        }
        if arg.starts_with("--") {
            return Err(format!(
                "unknown option '{arg}' — this CLI passes params as key=value or --json"
            ));
        }
        let (key, value) = arg
            .split_once('=')
            .ok_or_else(|| format!("'{arg}' is not key=value"))?;
        let key = key.trim();
        if key.is_empty() {
            return Err(format!("'{arg}' has no param name"));
        }
        params.insert(key.to_string(), typed(value));
        index += 1;
    }

    Ok((method.to_string(), Value::Object(params)))
}

fn typed(value: &str) -> Value {
    match serde_json::from_str::<Value>(value) {
        Ok(json) => json,
        Err(_) => Value::String(value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn a_command_line_becomes_a_method_and_its_params() {
        let (method, params) = parse(&args("term.open shell=/bin/sh cols=100")).expect("parsed");
        assert_eq!(method, "term.open");
        assert_eq!(params["shell"], "/bin/sh");
        assert_eq!(params["cols"], json!(100));
    }

    #[test]
    fn values_that_spell_json_are_json_and_text_stays_text() {
        assert_eq!(typed("100"), json!(100));
        assert_eq!(typed("true"), json!(true));
        assert_eq!(typed("null"), Value::Null);
        assert_eq!(typed("not base64"), json!("not base64"));
        assert_eq!(typed("\"100\""), json!("100"), "a quoted value stays text");
    }

    #[test]
    fn json_params_carry_the_object_and_win_over_key_value() {
        let (_, params) =
            parse(&args(r#"term.open shell=/tmp --json {"shell":"/bin/sh","cols":100}"#))
                .expect("parsed");
        assert_eq!(params["shell"], "/bin/sh", "--json is the exact shape asked for");
        assert_eq!(params["cols"], json!(100));
    }

    #[test]
    fn a_bad_command_line_is_a_sentence_not_a_panic() {
        assert!(parse(&args("--nope")).is_err());
        assert!(parse(&args("term.open --colour")).is_err());
        assert!(parse(&args("term.open shell")).is_err());
        assert!(parse(&args("term.open --json")).is_err());
        assert!(parse(&args("term.open --json [1,2]")).is_err());
        assert!(parse(&args("term.open --json nope")).is_err());
    }

    #[test]
    fn the_cli_answers_from_the_same_table_the_backend_serves() {
        let mut backend = Backend::new();
        for method in METHODS {
            let refused = backend.handle(method, &json!({})).err();
            assert_ne!(
                refused.map(|error| error.code),
                Some(-32601),
                "{method} is in METHODS but the library does not dispatch it"
            );
        }
        assert_eq!(
            backend
                .handle("term.nope", &json!({}))
                .map_err(|error| error.message),
            Err(format!(
                "'term.nope' is not a method this backend has ({})",
                METHODS.join(" | ")
            ))
        );
    }
}
