import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("./local-windows-job.ps1", import.meta.url));
const READY_TIMEOUT_MS = 10_000;
const ASSIGN_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 1_500;
const MAX_PROTOCOL_BUFFER = 4_096;

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function createWindowsJob({ onFailure, spawnProcess = spawn } = {}) {
  if (typeof onFailure !== "function") throw new TypeError("createWindowsJob requires an onFailure callback.");
  const guardian = spawnProcess("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath,
  ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  let closing = false;
  let closed = false;
  let failureReported = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let readyResolve;
  let readyReject;
  let assignResolve;
  let assignReject;
  let assignTimer;
  let assignmentQueue = Promise.resolve();
  let closePromise;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Readiness rejection may arrive before the caller observes the returned promise.
  ready.catch(() => {});

  function reportFailure(error) {
    if (closing || failureReported) return;
    failureReported = true;
    try {
      onFailure(error);
    } catch {
      // A notification callback must not break guardian cleanup or protocol handling.
    }
  }

  function failPending(error) {
    readyReject(error);
    if (assignReject) {
      clearTimeout(assignTimer);
      const reject = assignReject;
      assignResolve = undefined;
      assignReject = undefined;
      reject(error);
    }
  }

  function waitForExit() {
    if (closed) return Promise.resolve();
    return new Promise((resolve) => guardian.once("exit", resolve));
  }

  function handleLine(line) {
    if (line === "READY") {
      readyResolve();
    } else if (line === "ASSIGNED") {
      if (assignResolve) {
        clearTimeout(assignTimer);
        const resolve = assignResolve;
        assignResolve = undefined;
        assignReject = undefined;
        resolve();
      }
    } else if (line.startsWith("ERROR ")) {
      const error = new Error(`Windows job guardian: ${line.slice(6)}`);
      if (assignReject) {
        clearTimeout(assignTimer);
        const reject = assignReject;
        assignResolve = undefined;
        assignReject = undefined;
        reject(error);
      } else {
        failPending(error);
        reportFailure(error);
      }
    } else if (line.length > 0) {
      const error = new Error(`Windows job guardian returned an invalid response: ${line.slice(0, 256)}`);
      failPending(error);
      reportFailure(error);
    }
  }

  guardian.stdout?.setEncoding("utf8");
  guardian.stderr?.setEncoding("utf8");
  guardian.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk;
    if (stdoutBuffer.length > MAX_PROTOCOL_BUFFER) {
      const error = new Error("Windows job guardian exceeded the protocol output limit.");
      failPending(error);
      reportFailure(error);
      return;
    }
    let newline;
    while ((newline = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      handleLine(line);
    }
  });
  guardian.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > MAX_PROTOCOL_BUFFER) stderrBuffer = stderrBuffer.slice(-MAX_PROTOCOL_BUFFER);
  });
  guardian.stdin?.on("error", (error) => {
    if (!closing) {
      const failure = new Error(`Windows job guardian input failed: ${error.message}`);
      failPending(failure);
      reportFailure(failure);
    }
  });
  guardian.once("error", (error) => {
    const failure = new Error(`Could not start Windows job guardian: ${error.message}`);
    failPending(failure);
    reportFailure(failure);
  });
  guardian.once("exit", (code, signal) => {
    closed = true;
    const details = stderrBuffer.trim();
    const error = new Error(
      `Windows job guardian exited unexpectedly (${signal ?? `exit ${code}`})${details ? `: ${details}` : "."}`,
    );
    failPending(error);
    reportFailure(error);
  });

  try {
    await withTimeout(ready, READY_TIMEOUT_MS, "Timed out waiting for Windows job guardian readiness.");
  } catch (error) {
    closing = true;
    try {
      if (guardian.stdin?.writable) guardian.stdin.end();
      if (!closed) guardian.kill();
    } catch {
      // The bounded wait below still lets an already-exiting guardian release its handle.
    }
    if (!closed) {
      try {
        await withTimeout(waitForExit(), CLOSE_TIMEOUT_MS, "Windows job guardian did not exit after startup failure.");
      } catch {
        // Startup failure is already being reported; never leave cleanup unbounded.
      }
    }
    throw error;
  }

  async function assign(child) {
    if (closing || closed) throw new Error("Windows job guardian is closed.");
    if (!Number.isInteger(child?.pid) || child.pid <= 0) throw new Error("Cannot assign a child without a valid process ID.");
    const operation = assignmentQueue.then(async () => {
      if (closing || closed) throw new Error("Windows job guardian is closed.");
      const acknowledgment = new Promise((resolve, reject) => {
        assignResolve = resolve;
        assignReject = reject;
        assignTimer = setTimeout(() => {
          assignResolve = undefined;
          assignReject = undefined;
          reject(new Error("Timed out waiting for Windows job assignment."));
        }, ASSIGN_TIMEOUT_MS);
        assignTimer.unref?.();
      });
      try {
        guardian.stdin.write(`ASSIGN ${child.pid}\n`);
      } catch (error) {
        clearTimeout(assignTimer);
        assignResolve = undefined;
        assignReject = undefined;
        throw new Error(`Could not request Windows job assignment: ${error.message}`);
      }
      await acknowledgment;
    });
    assignmentQueue = operation.catch(() => {});
    return operation;
  }

  async function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      if (closed) return;
      try {
        if (guardian.stdin?.writable) {
          guardian.stdin.write("STOP\n");
          guardian.stdin.end();
        }
      } catch {
        // Falling back to terminating the guardian closes its kernel-owned job handle.
      }
      try {
        await withTimeout(waitForExit(), CLOSE_TIMEOUT_MS, "Windows job guardian did not stop after STOP.");
      } catch {
        if (!closed) guardian.kill();
      }
      if (!closed) {
        await withTimeout(waitForExit(), CLOSE_TIMEOUT_MS, "Windows job guardian did not terminate.");
      }
    })();
    return closePromise;
  }

  return { assign, close };
}