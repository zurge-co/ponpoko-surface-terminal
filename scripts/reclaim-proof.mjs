import { spawn } from "node:child_process";

const idleMs = 1200;
const child = spawn("./backend/target/release/terminal-backend", [], {
  env: { ...process.env, PONPOKO_TERMINAL_IDLE_MS: String(idleMs) },
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const waiting = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    const frame = JSON.parse(line);
    const waiter = waiting.get(frame.id);
    if (waiter) {
      waiting.delete(frame.id);
      waiter(frame);
    }
  }
});

let nextId = 1;
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

for (let i = 0; i < 8; i += 1) {
  const answer = await call("term.open", { cols: 80, rows: 24, client: "page-gone" });
  check(`open #${i + 1} got a session`, Boolean(answer.result?.id), JSON.stringify(answer));
}
const refused = await call("term.open", { cols: 80, rows: 24, client: "page-new" });
check("9th open is refused while all 8 are alive", refused.error?.code === -32000, JSON.stringify(refused));

const listed = await call("term.list");
const owned = listed.result.sessions.filter((session) => session.client === "page-gone");
check("term.list names the page that opened each session", owned.length === 8, JSON.stringify(listed.result.sessions.map((s) => [s.id, s.client])));

await new Promise((resolve) => setTimeout(resolve, idleMs + 400));

const reopened = await call("term.open", { cols: 80, rows: 24, client: "page-new" });
check("the same open succeeds once the silent sessions are swept", Boolean(reopened.result?.id), JSON.stringify(reopened));

const after = await call("term.list");
check("exactly one session survives, owned by the new page", after.result.sessions.length === 1 && after.result.sessions[0].client === "page-new", JSON.stringify(after.result));

child.stdin.end();
child.kill();

let failed = 0;
for (const { name, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
