import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function blocks(section) {
  const result = new Map();
  let key;
  for (const line of section.split("\n")) {
    const heading = /^  (\S.*):$/.exec(line);
    if (heading) {
      key = heading[1].replace(/^'|'$/g, "");
      result.set(key, "");
    } else if (key) result.set(key, result.get(key) + line + "\n");
  }
  return result;
}

function checkNativePackages(lock) {
  const packages = blocks(lock.split("\npackages:\n")[1].split("\nsnapshots:\n")[0]);
  const snapshots = blocks(lock.split("\nsnapshots:\n")[1]);
  for (const os of ["darwin", "win32"]) {
    for (const cpu of ["arm64", "x64"]) {
      const suffix = os === "win32" ? "-msvc" : "";
      for (const [parent, native] of [
        ["esbuild", `@esbuild/${os}-${cpu}`],
        ["rollup", `@rollup/rollup-${os}-${cpu}${suffix}`],
        ["lightningcss", `lightningcss-${os}-${cpu}${suffix}`],
        ["@tailwindcss/oxide", `@tailwindcss/oxide-${os}-${cpu}${suffix}`],
      ]) {
        const variants = [...packages].filter(([key]) => key.startsWith(`${native}@`));
        assert.ok(variants.length > 0, `Missing ${native} in lockfile packages`);
        for (const [key, body] of variants) {
          assert.ok(body.includes(`os: [${os}]`), `${key} must declare its OS`);
          assert.ok(body.includes(`cpu: [${cpu}]`), `${key} must declare its CPU`);
          assert.ok(snapshots.has(key), `${key} needs an install snapshot`);
        }
        const parents = [...snapshots].filter(([key]) => key.startsWith(`${parent}@`));
        assert.ok(parents.length > 0, `Missing parent ${parent}`);
        for (const [key, body] of parents) {
          const optional = body.split("    optionalDependencies:\n")[1]?.split(/\n    \S/)[0];
          assert.ok(optional, `${key} needs optional dependencies`);
          assert.ok(optional.split("\n").some((line) => {
            const entry = /^      '?([^']+?)'?: (.+)$/.exec(line);
            return entry?.[1] === native && packages.has(`${native}@${entry[2]}`);
          }), `${native} must remain an optional dependency of ${key}`);
        }
      }
    }
  }
}

test("lockfile retains OS/CPU-specific optional Mac and Windows tools", async () => {
  checkNativePackages(await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"));
});

test("native lockfile check rejects a removed Mac or Windows package", async () => {
  const lock = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  for (const native of ["@esbuild/darwin-arm64", "@rollup/rollup-win32-arm64-msvc"]) {
    assert.throws(() => checkNativePackages(lock.replace(`  '${native}@`, "  'removed-native@")), /Missing/);
  }
});