import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkLocalServer, choosePort, localEnvironments, localServerSettings, portAvailable, portRequest, redactTokens, serverBanner } from "./local-config.mjs";
import { tokenSafeOutput } from "./local-output.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "artifacts", "api-server");
const webDir = path.join(root, "artifacts", "openwork");
const windows = process.platform === "win32";
const children = new Set();
const abort = new AbortController();
let stopping = false;
let ready = false;
let shutdownPromise;
let windowsJob;
let outputTokens = [];

async function launch(label, args, cwd, env) {
  const childArgs = windows ? [path.join(root, "scripts", "local-child.mjs"), ...args] : args;
  const child = spawn(process.execPath, childArgs, {
    cwd, env, stdio: windows ? ["inherit", "pipe", "pipe", "ipc"] : ["inherit", "pipe", "pipe"],
    detached: !windows, windowsHide: true,
  });
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    const output = tokenSafeOutput(text => target.write(text), outputTokens);
    stream.on("data", output.data);
    stream.on("end", output.end);
  }
  children.add(child);
  child.on("error", (error) => {
    if (!stopping) void shutdown(1, `${label} failed to start: ${error.message}`);
  });
  if (windows) {
    // The anchor waits on IPC until it belongs to the kernel job. All native
    // helper processes it subsequently creates inherit that ownership.
    await windowsJob.assign(child);
    if (!stopping && child.connected) child.send("start");
  }
  return child;
}

function supervise(child, label) {
  child.once("exit", (code, signal) => {
    if (!stopping) {
      const phase = ready ? "stopped" : "failed to start";
      void shutdown(1, `${label} ${phase} (${signal ?? `exit ${code}`}). Check its output above.`);
    }
  });
}

function stopTree(child, signal) {
  if (!child.pid) return Promise.resolve();
  if (windows) {
    // The job closes the complete tree, including descendants of a dead root.
    // This also stops any anchor whose job assignment failed before startup.
    if (!exited(child)) child.kill("SIGKILL");
    return Promise.resolve();
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") console.error(`Could not stop ${child.pid}: ${error.message}`);
  }
  return Promise.resolve();
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function shutdown(code, message) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  abort.abort();
  if (message) console.error(`[local] ${redactTokens(message, outputTokens)}`);
  console.log("[local] Stopping both servers...");
  shutdownPromise = (async () => {
    const active = [...children];
    if (windowsJob) {
      try { await windowsJob.close(); }
      catch (error) { console.error(`[local] Windows cleanup failed: ${error.message}`); code = 1; }
    }
    await Promise.all(active.map((child) => stopTree(child, "SIGTERM")));
    const deadline = Date.now() + 4_000;
    while (active.some((child) => !exited(child)) && Date.now() < deadline) await delay(50);
    // Kill Unix process groups even if a parent has exited, so native helpers
    // cannot survive a child crash or an interrupted API build.
    if (!windows) await Promise.all(active.map((child) => stopTree(child, "SIGKILL")));
    process.exit(code);
  })();
  return shutdownPromise;
}

// Keep handlers installed during cleanup so a second Ctrl+C cannot interrupt
// termination and leave detached children behind.
process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

async function buildApi(env) {
  console.log("[local] Building the API...");
  const child = await launch("API build", [path.join(apiDir, "build.mjs")], apiDir, env);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`API build failed (${signal ?? `exit ${code}`}). Check its output above.`));
    });
  });
  children.delete(child);
}

async function waitForHealth(url, label) {
  const deadline = Date.now() + 30_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1_000)]),
      });
      const body = await response.json();
      if (response.ok && body.status === "ok") return;
    } catch {
      if (stopping) throw new Error("Startup interrupted.");
    }
    await delay(150, undefined, { signal: abort.signal });
  }
  throw new Error(`${label} failed to start: health check did not answer within 30 seconds (${url}).`);
}

async function main() {
  const server = localServerSettings(process.env);
  outputTokens = server?.secrets ?? [];
  const vite = path.join(webDir, "node_modules", "vite", "bin", "vite.js");
  try {
    await access(vite);
    await access(path.join(apiDir, "node_modules", "esbuild"));
  } catch {
    throw new Error("Dependencies are missing. Run pnpm install at the repository root first.");
  }
  const apiRequest = portRequest(process.env.LOCAL_API_PORT, 8788, "LOCAL_API_PORT");
  const webRequest = portRequest(process.env.LOCAL_WEB_PORT, 5173, "LOCAL_WEB_PORT");
  const apiPort = await choosePort(apiRequest, portAvailable);
  const webPort = await choosePort(webRequest, portAvailable, [apiPort]);
  for (const [label, request, chosen] of [
    ["API", apiRequest, apiPort], ["Web", webRequest, webPort],
  ]) {
    console.log(`[local] ${label} port: ${chosen}${chosen !== request.port ? ` (default ${request.port} unavailable; using next free port)` : ""}`);
  }
  const env = localEnvironments(process.env, webPort, apiPort, server);
  if (windows) {
    const { createWindowsJob } = await import("./local-windows-job.mjs");
    windowsJob = await createWindowsJob({
      onFailure: (error) => {
        if (!stopping) void shutdown(1, `Windows process supervision failed: ${error.message}`);
      },
    });
  }
  await buildApi(env.api);
  if (stopping) return;
  const api = await launch("API", ["--enable-source-maps", path.join(apiDir, "dist", "index.mjs")], apiDir, env.api);
  supervise(api, "API");
  await waitForHealth(`http://127.0.0.1:${apiPort}/api/healthz`, "API");
  if (stopping) return;
  const warning = await checkLocalServer(server);
  if (warning) console.warn(`[local] ${warning}`);
  if (stopping) return;
  const web = await launch("Web", [vite, "--config", path.join(webDir, "vite.config.ts"), "--host", "127.0.0.1"], webDir, env.web);
  supervise(web, "Web");
  const address = `http://127.0.0.1:${webPort}`;
  await waitForHealth(`${address}/api/healthz`, "Web /api proxy");
  ready = true;
  if (server) console.log(`[local] ${serverBanner(server)}`);
  console.log(`\n[local] Ready\n[local] Web:          ${address}/\n[local] Orchestrator: ${address}/orchestrator\n[local] Hierarchy:    ${address}/orchestrator/hierarchy\n[local] API:          http://127.0.0.1:${apiPort} (/api/healthz)\n[local] Complete hosted sign-in, then paste the code into OpenWork.\n[local] Ctrl+C stops both servers.\n`);
}

main().catch((error) => {
  if (!stopping) void shutdown(1, error.message);
});