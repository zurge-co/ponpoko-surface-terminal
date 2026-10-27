import "@xterm/xterm/css/xterm.css";
import "./styles.css";

import { createSurfaceLink, parentTransport, viewTokenFromLocation } from "./bridge";
import { createTerminalApp } from "./terminal";

function renderUnhosted(root: HTMLElement): void {
  const shell = document.createElement("div");
  shell.className = "unhosted";

  const mark = document.createElement("div");
  mark.className = "unhosted-mark";
  mark.textContent = ">_";

  const heading = document.createElement("h1");
  heading.textContent = "Terminal — a Ponpoko surface";

  const body = document.createElement("p");
  body.textContent =
    "Ponpoko loads this page inside its own window and starts the backend process that owns the shells. The page itself has no PTY and no way to reach this machine.";

  const detail = document.createElement("p");
  detail.textContent =
    "Opened on its own there is no host to ask, so no shell would run — nothing here would be true.";

  shell.append(mark, heading, body, detail);
  root.replaceChildren(shell);
}

function main(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("the terminal surface has no #app element to mount into");

  const view = viewTokenFromLocation();
  if (view.length === 0) {
    renderUnhosted(root);
    return;
  }

  const link = createSurfaceLink({ view, transport: parentTransport() });
  createTerminalApp({ root, link });
}

main();
