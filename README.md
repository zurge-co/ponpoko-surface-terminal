# Terminal — a Ponpoko surface

A real terminal inside Ponpoko: every tab is a shell child process spawned into a
PTY by this surface's own backend, with your environment and your rights. It is
an **installed surface**, like the editor — Ponpoko hosts the page and starts the
backend, but the shell is not Ponpoko's process and Ponpoko does not mediate it.

There is **no sandbox**. A surface is code you chose to install, and this one
runs your shell. The terminal asks Ponpoko for exactly one thing, `backend.call`,
to talk to its own backend.

## Install

This is a repository of its own — `zurge-co/ponpoko-surface-terminal` — with its
own `bun.lock` and its own build task, so it builds from a checkout of itself and
from nothing else:

```sh
git clone git@github.com:zurge-co/ponpoko-surface-terminal.git
cd ponpoko-surface-terminal
bun install
bun run build
bun test
```

Ponpoko clones this repository itself (`poko surface-clone`), builds it
(`poko surface-build`) and installs the `dist/` that comes out
(`poko surface-install --bundle dist`). The bundle contains the page,
`surface.json`, and both compiled programs: `bin/terminal-backend` (what Ponpoko
starts) and `bin/terminal-cli` (the surface's own command line).

## Keys

| Key | Sends | Meaning |
| --- | --- | --- |
| Option+← / → | `ESC b` / `ESC f` | previous / next word |
| Option+Backspace | `ESC DEL` | delete the previous word |
| Option+Delete | `ESC d` | delete the next word |
| Cmd+← / → | `Ctrl-A` / `Ctrl-E` | beginning / end of line |
| Cmd+Backspace | `Ctrl-U` | delete before the cursor |
| Cmd+Delete | `Ctrl-K` | delete after the cursor |
| Cmd+↑ / ↓ | — | scroll to top / bottom |
| Option+↑ / ↓ | — | page up / page down |
| Cmd+C | — | copy the selection |
| Cmd+T / Ctrl+Shift+T | — | open a new tab |
| Alt+Shift+← / → | — | move the focused tab left / right |

### Tabs

- **New** — the `+` button, `Cmd+T` on macOS, or `Ctrl+Shift+T` elsewhere.
- **Rename** — double-click a tab title. Enter or clicking away commits, Escape
  cancels, an empty name keeps the old one, and the label is capped at 40
  characters. A rename sends nothing to the shell and does not restart the
  session.
- **Reorder** — drag a tab; a bright green insertion cursor marks the gap
  where it will land. `Alt+Shift+←/→` moves the focused tab from the keyboard.
  Reordering moves the tab object, so the shell and its scrollback are **not**
  restarted or duplicated.
- Tab names are UI-only and do not survive an app restart (nothing about a tab
  does).

Ctrl combinations are left to the shell: Ctrl+C must keep reaching the process,
and Ctrl+Arrow is a different terminal convention. Shift-modified editing keys
are not remapped.

## Thai

- xterm runs with the **unicode-graphemes addon** (`allowProposedApi`): a Thai
  base character plus its combining vowels and tone marks occupies one cell, so
  the cursor and backspace stay on the glyph instead of drifting.
- The font stack falls back to the Thai faces macOS installs: IBM Plex Sans Thai
  Looped, Thonburi, Ayuthaya.
- PTY output and input cross the bridge as **base64 bytes**. A Thai character is
  three UTF-8 bytes and a PTY read may split it; xterm's decoder joins the
  writes instead of the page corrupting the character.
- Thai keyboard layouts and IME composition are handled by xterm's own textarea.

Whether a particular Thai word looks right at a particular font size is a
visual check for a human, not something a unit test can prove.

## How output arrives (and its limits)

The host's surface bridge is request/response — a surface cannot receive
unsolicited messages — so the page polls the backend with `term.poll`. While
data is flowing it polls again immediately (one host round trip, ~1 ms here),
and when the shell goes quiet the pause **decays**: 16 ms after the last byte,
then 32, 64, 128, 256, and 500 ms once nothing has moved for a second. A
keystroke or new output resets it to 16 ms, so typing echo and a prompt
returning after a hiccup are not delayed by the idle interval. Output is written
to xterm at most once per animation frame instead of once per poll. This is not
a byte-for-byte real-time stream, and the honest limits are:

- **Output is bounded.** Each session keeps at most 4 MiB. When a long build
  outruns the page, the backend drops the **oldest** bytes and reports how many;
  the terminal prints that notice. The tail is preserved, the head is not.
- **Sessions belong to one window.** The backend is per window: Ponpoko starts a
  separate process for each window that opens a terminal, so the 8-shell limit
  (`MAX_SESSIONS`) is **8 per window**, and one window's busy terminal does not
  delay another's. A tab sees only its own window's shells; nothing is shared or
  handed over between windows. Closing a window closes its shells — the page
  sends `term.close` on the way out and the host then stops that window's
  backend process (`shutdown_window` on the window's `Destroyed` event), which
  signals the shells' process group with it.
- **The host logs every backend frame, up to a cap.** Ponpoko records this
  surface's JSON-RPC requests and answers (base64 terminal input and output
  included) at `<app data dir>/logs/surface-backends/terminal.log` for the main
  window, and `terminal-<window label>.log` for any other window. That is the
  host's backend policy, not this surface's choice. Each file is capped at
  **8 MiB**: when a write would cross the cap the current file becomes
  `<name>.1` (replacing the previous one) and a fresh log starts, so there are
  never more than two files and never more than ~16 MiB per window. Uninstalling
  the surface does not delete them — a broken backend explains itself nowhere
  else — so still treat the log as terminal scrollback written to disk: anything
  you type into a shell is in it until the cap rolls it over.
- **Idle polls cost log lines.** The pause is never shorter than 16 ms, and it
decays back to 500 ms as the shell stays quiet: every poll is a logged frame, so
16 ms is the floor right after activity, not the cadence of a terminal sitting
at a prompt. A background job's output still arrives within half a second; a
window that regains focus asks again immediately.
- **A hidden tab can be throttled.** The webview may slow timers in a
  backgrounded iframe; output then accumulates in the bounded buffer and may
  drop older bytes. Switching back catches up from the tail.
- **Tabs do not survive an app restart.** There is no session persistence: the
  shells die with Ponpoko, and the next launch starts fresh. Tab names and order
  are not persisted either.
- **No shell picker, no scrollback search.** A tab starts `$SHELL` (falling back
  to `/bin/zsh`, `/bin/bash`, `/bin/sh`) in `$HOME`; `cd` from there.
- **The key map reaches the shell's keymap.** `ESC b` is a word motion in zsh's
  default emacs keymap and in bash readline; a shell in vi mode will not treat
  it that way. The page sends the standard macOS-terminal bytes and does not
  pretend to know which mode the shell is in.
- **No sandbox.** Do not read this surface as isolation; it is your shell.

## Backend methods

`app.ping`, `app.info`, `term.open`, `term.write`, `term.poll`, `term.resize`,
`term.close`, `term.list`. JSON-RPC 2.0 over stdin/stdout, one object per line.
Output is base64 because a PTY is a byte stream.

The table lives in `backend/src/lib.rs`, and two programs read it:
`bin/terminal-backend` (the JSON-RPC process Ponpoko starts) and `bin/terminal-cli`
(the surface's own command line).

## The surface's own CLI

`bin/terminal-cli` runs a method with no app in between — useful for checking a
shell, and for scripts that need a real PTY. `surface.json` says it exists
(`"cli": { "command": "bin/terminal-cli" }`); Ponpoko reads that path and never
runs it.

```sh
bin/terminal-cli --list
bin/terminal-cli app.info
bin/terminal-cli term.list
```

A shell belongs to the process that opened it, so a one-shot `term.open` ends
with the CLI. To drive a shell across calls, run a batch — one call per line on
stdin, one JSON answer per line on stdout, one process, one session:

```sh
printf '%s\n' \
  'term.open shell=/bin/sh cols=100 rows=30' \
  'term.write id=SESSION data=cHdkCg==' \
  'term.poll id=SESSION max_bytes=65536' \
  'term.close id=SESSION' | bin/terminal-cli --batch
```

`key=value` values are typed the way JSON spells them and stay text otherwise;
use `--json` when a value must be exactly a string. The CLI kills every shell it
opened before it exits.
