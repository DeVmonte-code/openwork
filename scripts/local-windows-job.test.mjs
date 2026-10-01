import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { createWindowsJob } from "./local-windows-job.mjs";

class FakeGuardian extends EventEmitter {
  constructor() {
    super();
    this.pid = 123;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const command = chunk.toString().trim();
        if (command.startsWith("ASSIGN ")) queueMicrotask(() => this.stdout.write("ASSIGNED\n"));
        if (command === "STOP") queueMicrotask(() => this.finish(0, null));
        callback();
      },
    });
  }

  kill() {
    this.finish(null, "SIGTERM");
    return true;
  }

  finish(code, signal) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

function fakeSpawn() {
  const guardian = new FakeGuardian();
  const spawnProcess = (command, args, options) => {
    assert.equal(command, "powershell.exe");
    assert.ok(args.includes("-NonInteractive"));
    assert.equal(options.windowsHide, true);
    queueMicrotask(() => guardian.stdout.write("READY\n"));
    return guardian;
  };
  return { guardian, spawnProcess };
}

test("Windows job waits for readiness, acknowledges assignment, and stops guardian", async () => {
  const { guardian, spawnProcess } = fakeSpawn();
  const failures = [];
  const job = await createWindowsJob({ spawnProcess, onFailure: (error) => failures.push(error) });

  await job.assign({ pid: 456 });
  await job.close();

  assert.equal(guardian.exitCode, 0);
  assert.deepEqual(failures, []);
});

test("unexpected guardian exit reports failure and rejects readiness", async () => {
  const guardian = new FakeGuardian();
  const failures = [];
  const spawnProcess = () => guardian;
  const pending = createWindowsJob({ spawnProcess, onFailure: (error) => failures.push(error) });
  guardian.finish(1, null);

  await assert.rejects(pending, /exited unexpectedly/);
  assert.match(failures[0].message, /exited unexpectedly/);
});

test("assignment failures are explicit", async () => {
  const { guardian, spawnProcess } = fakeSpawn();
  guardian.stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      if (chunk.toString().startsWith("ASSIGN ")) queueMicrotask(() => guardian.stdout.write("ERROR AssignProcessToJobObject failed.\n"));
      else if (chunk.toString().startsWith("STOP")) queueMicrotask(() => guardian.finish(0, null));
      callback();
    },
  });
  const job = await createWindowsJob({ spawnProcess, onFailure() {} });
  await assert.rejects(job.assign({ pid: 456 }), /AssignProcessToJobObject failed/);
  await job.close();
});