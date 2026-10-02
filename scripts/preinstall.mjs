import { rmSync } from "node:fs";
import path from "node:path";

// Same lockfile cleanup and pnpm-only policy on every operating system.
for (const file of ["package-lock.json", "yarn.lock"]) rmSync(file, { force: true });
const agent = process.env.npm_config_user_agent;
// pnpm 11 may omit the versioned user-agent during install lifecycle hooks.
const executable = path.win32.basename(path.basename(process.env.npm_execpath ?? ""));
const pnpm = agent === "pnpm" || agent?.startsWith("pnpm/")
  || (!agent && /^pnpm(?:\.[cm]?js)?$/.test(executable));
if (!pnpm) {
  console.error("Use pnpm instead");
  process.exitCode = 1;
}