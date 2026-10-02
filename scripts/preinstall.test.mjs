import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

for (const [agent, expected] of [["pnpm/10.26.1", 0], ["npm/11.0.0", 1]]) {
  test(`portable preinstall preserves cleanup and policy for ${agent}`, async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "openwork-preinstall-"));
    try {
      for (const file of ["package-lock.json", "yarn.lock"]) await writeFile(path.join(cwd, file), "");
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./preinstall.mjs", import.meta.url))], {
        cwd, env: { ...process.env, npm_config_user_agent: agent }, encoding: "utf8",
      });
      assert.equal(result.status, expected);
      if (expected !== 0) assert.match(result.stderr, /Use pnpm instead/);
      for (const file of ["package-lock.json", "yarn.lock"]) {
        await assert.rejects(access(path.join(cwd, file)), { code: "ENOENT" });
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
}