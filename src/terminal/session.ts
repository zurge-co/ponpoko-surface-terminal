import type { Tab } from "./strip";
import type { PollAnswer, TerminalApi } from "../api";
import { decodeBase64 } from "../base64";
import { MAX_POLL_BYTES, POLL_ACTIVE_MS, nextPollDelay } from "../config";

const MAX_PENDING_INPUT = 64 * 1024;

export interface SessionPorts {
  api: TerminalApi;
  say(text: string, error?: boolean): void;
  writeOut(tab: Tab, data: string | Uint8Array): void;
  wake(tab: Tab): void;
  waitForWake(tab: Tab, ms: number): Promise<void>;
  message(error: unknown): string;
  sendInput(tab: Tab, data: string): Promise<void>;
  shellName(shell: string): string;
  renderTabs(): void;
  flushOut(tab: Tab): void;
}

export function sessionOps(ports: SessionPorts) {
  const api = ports.api;
  const say = ports.say;
  const writeOut = ports.writeOut;
  const wake = ports.wake;
  const waitForWake = ports.waitForWake;
  const message = ports.message;
  const renderTabs = ports.renderTabs;
  const flushOut = ports.flushOut;
  const sendInput = ports.sendInput;
  const shellName = ports.shellName;
  async function startSession(tab: Tab, cols: number, rows: number): Promise<void> {
    try {
      const info = await api.open({ cols, rows });
      if (!tab.alive) {
        void api.close(info.id).catch(() => {});
        return;
      }
      tab.backendId = info.id;
      tab.cols = info.cols;
      tab.rows = info.rows;
      tab.status = "running";
      tab.title = `${shellName(info.shell)} ${tab.index}`;
      renderTabs();

      const pending = tab.pending.join("");
      tab.pending = [];
      tab.pendingBytes = 0;
      if (pending.length > 0) queueInput(tab, pending);

      void pollLoop(tab);
      tab.term.focus();
    } catch (error) {
      failTab(tab, `The shell could not be started: ${message(error)}`);
    }
  }

  async function pollLoop(tab: Tab): Promise<void> {
    while (tab.alive && tab.backendId) {
      let answer: PollAnswer;
      try {
        answer = await api.poll(tab.backendId, MAX_POLL_BYTES);
      } catch (error) {
        if (!tab.alive) return;
        failTab(tab, `The terminal backend stopped answering: ${message(error)}`);
        return;
      }
      if (!tab.alive) return;

      if (answer.data.length > 0) writeOut(tab, decodeBase64(answer.data));
      if (answer.dropped > 0) {
        writeOut(
          tab,
          `\r\n\x1b[90m[Ponpoko: ${answer.dropped} bytes of earlier output were dropped to keep the terminal buffer bounded]\x1b[0m\r\n`,
        );
      }
      if (answer.exited) {
        markExited(tab, answer);
        return;
      }
      if (answer.bytes > 0 || tab.wakeRequested) {
        tab.wakeRequested = false;
        tab.pollDelay = POLL_ACTIVE_MS;
        continue;
      }
      const delay = tab.pollDelay;
      tab.pollDelay = nextPollDelay(delay);
      await waitForWake(tab, delay);
    }
  }

  function markExited(tab: Tab, answer: PollAnswer): void {
    tab.alive = false;
    tab.status = "exited";
    tab.wakeRequested = false;
    const how =
      typeof answer.signal === "string" && answer.signal.length > 0
        ? `signal ${answer.signal}`
        : `code ${answer.exit_code ?? "unknown"}`;
    writeOut(tab, `\r\n\x1b[90m[process exited: ${how}]\x1b[0m\r\n`);
    flushOut(tab);
    if (tab.backendId) void api.close(tab.backendId).catch(() => {});
    renderTabs();
  }

  function failTab(tab: Tab, sentence: string): void {
    if (!tab.alive) return;
    tab.alive = false;
    tab.status = "failed";
    wake(tab);
    writeOut(tab, `\r\n\x1b[31m${sentence}\x1b[0m\r\n`);
    flushOut(tab);
    if (tab.backendId) void api.close(tab.backendId).catch(() => {});
    renderTabs();
    say(sentence, true);
  }

  function queueInput(tab: Tab, data: string): void {
    if (data.length === 0) return;
    if (!tab.backendId) {
      if (tab.pendingBytes + data.length <= MAX_PENDING_INPUT) {
        tab.pending.push(data);
        tab.pendingBytes += data.length;
      }
      return;
    }
    tab.inputQueue = tab.inputQueue.then(() =>
      sendInput(tab, data).catch((error) => {
        failTab(tab, `Input could not reach the shell: ${message(error)}`);
      }),
    );
  }

  return { startSession, pollLoop, markExited, failTab, queueInput };
}
