use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};


pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

pub fn resolve_cwd(requested: Option<&str>) -> PathBuf {
    if let Some(directory) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(directory);
        if path.is_dir() {
            return path;
        }
    }
    home_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg(unix)]
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

#[cfg(windows)]
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

#[cfg(unix)]
pub fn default_shell() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(shell) = std::env::var_os("SHELL") {
        candidates.push(PathBuf::from(shell));
    }
    candidates.extend([
        PathBuf::from("/bin/zsh"),
        PathBuf::from("/bin/bash"),
        PathBuf::from("/bin/sh"),
    ]);
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(windows)]
pub fn default_shell() -> Option<PathBuf> {
    std::env::var_os("COMSPEC")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| Some(PathBuf::from("powershell.exe")))
}

#[cfg(unix)]
pub fn shell_exists(path: &Path) -> bool {
    path.is_file()
}

#[cfg(windows)]
pub fn shell_exists(path: &Path) -> bool {
    path.is_file() || path.components().count() == 1
}

#[cfg(unix)]
pub fn login_flag(shell: &Path) -> Option<&'static str> {
    let name = shell.file_name()?.to_string_lossy();
    matches!(
        name.as_ref(),
        "zsh" | "bash" | "sh" | "dash" | "ksh" | "fish"
    )
    .then_some("-l")
}

#[cfg(windows)]
pub fn login_flag(_shell: &Path) -> Option<&'static str> {
    None
}
