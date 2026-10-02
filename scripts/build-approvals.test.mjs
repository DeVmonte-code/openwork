import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkBuildApprovals } from "./build-approvals.mjs";

const workspace = await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
test("workspace approves the same exact builds in pnpm 10 and 11", () => {
  assert.doesNotThrow(() => checkBuildApprovals(workspace));
});
test("build approval guard rejects missing, extra or disagreeing approvals", () => {
  for (const changed of [
    workspace.replace("  - msw\n", ""),
    workspace.replace("  msw: true", "  msw: false"),
    workspace.replace("  - esbuild\n", "  - esbuild\n  - surprise\n"),
    workspace.replace("  esbuild: true", "  esbuild: true\n  surprise: true"),
    workspace.replace("onlyBuiltDependencies:", "removed:"),
    workspace.replace("allowBuilds:", "removed:"),
  ]) assert.throws(() => checkBuildApprovals(changed));
});
test("Scarf must remain explicitly false, not true or absent", () => {
  assert.throws(() => checkBuildApprovals(workspace.replace("'@scarf/scarf': false", "'@scarf/scarf': true")));
  assert.throws(() => checkBuildApprovals(workspace.replace("  '@scarf/scarf': false\n", "")));
});