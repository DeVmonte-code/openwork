import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const expected = ["@swc/core", "esbuild", "msw", "unrs-resolver"];

// Fail closed on unsupported formatting instead of treating unparsed YAML as safe.
// No YAML dependency is needed for these two deliberately simple block settings.
function lines(text, key) {
  const entries = [...text.matchAll(new RegExp(`^${key}:[ \\t]*(?:#[^\\n]*)?\\r?\\n((?:[ \\t]+[^\\n]*\\n|[ \\t]*\\n)*)`, "gm"))];
  if (entries.length !== 1) throw new Error(`Expected one ${key} block.`);
  return entries[0][1].split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
}

export function checkBuildApprovals(text) {
  const legacy = lines(text, "onlyBuiltDependencies").map(line => {
    const match = /^-\s+['"]?([@\w/.-]+)['"]?\s*(?:#.*)?$/.exec(line);
    if (!match) throw new Error("Unsupported onlyBuiltDependencies entry.");
    return match[1];
  });
  const modern = new Map();
  for (const line of lines(text, "allowBuilds")) {
    const match = /^['"]?([@\w/.-]+)['"]?:\s*(true|false)\s*(?:#.*)?$/.exec(line);
    if (!match || modern.has(match[1])) throw new Error("Unsupported or duplicate allowBuilds entry.");
    modern.set(match[1], match[2] === "true");
  }
  const same = values => JSON.stringify([...values].sort()) === JSON.stringify([...expected].sort());
  if (!same(legacy) || !same([...modern].filter(([, allowed]) => allowed).map(([name]) => name))) {
    throw new Error("pnpm 10 and 11 build approvals must both equal @swc/core, esbuild, msw and unrs-resolver.");
  }
  if (modern.get("@scarf/scarf") !== false) throw new Error("@scarf/scarf must be explicitly disallowed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkBuildApprovals(await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"));
  console.log("pnpm 10/11 build approvals match; Scarf is disallowed.");
}