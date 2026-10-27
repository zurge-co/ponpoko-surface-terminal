use std::io::{BufRead, Write};

use terminal_backend::{respond, Backend};

fn main() {
    eprintln!("terminal backend ready (pid {})", std::process::id());
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut backend = Backend::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("stdin could not be read: {error}");
                break;
            }
        };
        let Some(response) = respond(&mut backend, line.trim()) else {
            continue;
        };
        if writeln!(stdout, "{response}")
            .and_then(|()| stdout.flush())
            .is_err()
        {
            break;
        }
    }
    backend.shutdown();
    eprintln!("terminal backend exiting (stdin closed)");
}
