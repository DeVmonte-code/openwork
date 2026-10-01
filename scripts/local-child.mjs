import path from "node:path";
import { pathToFileURL } from "node:url";

let started = false;

process.on("disconnect", () => {
  if (!started) process.exit(0);
});

process.on("message", async (message) => {
  if (message !== "start" || started) return;
  started = true;
  process.disconnect();

  const args = process.argv.slice(2);
  const entryIndex = args.findIndex((argument) => argument !== "--enable-source-maps");
  if (entryIndex < 0) {
    console.error("Windows child wrapper requires a target module.");
    process.exitCode = 1;
    return;
  }
  if (args.slice(0, entryIndex).includes("--enable-source-maps")) {
    process.setSourceMapsEnabled(true);
  }

  const target = args[entryIndex];
  const targetArgs = args.slice(entryIndex + 1);
  process.argv = [process.execPath, target, ...targetArgs];
  try {
    await import(pathToFileURL(path.resolve(target)).href);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});