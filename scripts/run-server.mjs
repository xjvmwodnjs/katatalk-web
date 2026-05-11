import { spawn } from "node:child_process";

const [mode, command, ...args] = process.argv.slice(2);

if (!mode || !command) {
  console.error("Usage: node scripts/run-server.mjs <development|production> <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  env: {
    ...process.env,
    NODE_ENV: mode,
  },
  shell: true,
  stdio: "inherit",
});

child.on("exit", code => {
  process.exit(code ?? 0);
});
