import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = "dist";
const MANIFEST = "surface.json";

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function isWindows() {
  return process.platform === "win32";
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  return new Promise((resolved, rejected) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      rejected(
        error.code === "ENOENT"
          ? new Error(`'${command}' is not on PATH — install it and try again`)
          : error,
      );
    });
    child.on("exit", (code) => {
      if (code === 0) resolved();
      else rejected(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function readManifest(bundleDir, source) {
  let text;
  try {
    text = await readFile(source, "utf8");
  } catch (error) {
    fail(`no ${MANIFEST} next to this project: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    fail(`${MANIFEST} is not valid JSON: ${error.message}`);
  }
  if (!manifest.id || !manifest.entry) fail(`${MANIFEST} has no id or entry`);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function bundlePrograms(manifest, bundleDir) {
  const cargoManifest = join(PROJECT, "backend", "Cargo.toml");
  const declared = [];
  if (manifest.backend) declared.push({ kind: "backend", program: manifest.backend });
  if (manifest.cli) declared.push({ kind: "cli", program: manifest.cli });
  const hasBackendSource = await isFile(cargoManifest);

  if (declared.length === 0) {
    if (hasBackendSource) {
      fail(
        "this project has backend/ but surface.json declares no backend or cli — declare it or remove the folder, never one without the other",
      );
    }
    return [];
  }
  if (!hasBackendSource) fail(`surface.json declares a program but backend/Cargo.toml does not exist`);

  const names = declared.map(({ program }) => program.command);
  console.log(`build: compiling ${declared.length} program(s) (${names.join(", ")})`);
  await run("cargo", ["build", "--release", "--bins", "--manifest-path", cargoManifest], PROJECT);

  const releaseDir = join(PROJECT, "backend", "target", "release");
  const shipped = [];
  for (const { kind, program } of declared) {
    const command =
      isWindows() && !program.command.toLowerCase().endsWith(".exe")
        ? `${program.command}.exe`
        : program.command;
    const artifact = command.split("/").pop();
    const built = join(releaseDir, artifact);
    if (!(await isFile(built))) {
      fail(`cargo did not produce ${built} for the ${kind} '${program.command}'`);
    }
    const destination = join(bundleDir, command);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(built, destination);
    if (!isWindows()) await chmod(destination, 0o755);
    shipped.push({ kind, command });
    if (command !== program.command) manifest[kind] = { ...program, command };
  }
  return shipped;
}

async function verify(manifest, bundleDir, shipped) {
  const entry = join(bundleDir, manifest.entry);
  if (!(await isFile(entry))) fail(`the bundle has no entry '${manifest.entry}' — an install would refuse it`);
  if (!(await isFile(join(bundleDir, MANIFEST)))) {
    fail(`the bundle has no ${MANIFEST} — an install would refuse it`);
  }
  for (const { kind, command } of shipped) {
    if (!(await isFile(join(bundleDir, command)))) {
      fail(`the bundle has no ${kind} at '${command}' — an install would refuse it`);
    }
  }
  const files = await readdir(bundleDir, { recursive: true, withFileTypes: true });
  const count = files.filter((item) => item.isFile()).length;
  const page = (await stat(entry)).size;
  console.log(`build: ${manifest.id} v${manifest.version} — ${count} files, page ${page} B`);
  console.log(`build: installable bundle at ${bundleDir}`);
}

async function main() {
  const bundleDir = join(PROJECT, BUNDLE);
  const manifest = await readManifest(bundleDir, join(PROJECT, MANIFEST));
  const shipped = await bundlePrograms(manifest, bundleDir);
  if (shipped.length > 0) {
    await writeFile(join(bundleDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  await verify(manifest, bundleDir, shipped);
}

main().catch((error) => fail(error.message));
