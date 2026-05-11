import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [mode, command, ...args] = process.argv.slice(2);

if (!mode || !command) {
  console.error("Usage: node scripts/run-server.mjs <development|production> <command> [...args]");
  process.exit(1);
}

let execFile = command;
let spawnArgs = args;

// Windows: bare `tsx` is often not on PATH for child processes. Run the CLI via Node.
if (command === "tsx") {
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) {
    console.error(`[run-server] tsx CLI not found at:\n  ${tsxCli}\nRun: pnpm install`);
    process.exit(1);
  }
  execFile = process.execPath;
  spawnArgs = [tsxCli, ...args];
}

const child = spawn(execFile, spawnArgs, {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: mode,
  },
  shell: false,
  stdio: "inherit",
});

child.on("error", err => {
  console.error("[run-server] Failed to spawn process:", err.message);
  process.exit(1);
});

child.on("exit", code => {
  process.exit(code ?? 0);
});
