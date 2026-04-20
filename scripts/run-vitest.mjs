import { spawn } from "node:child_process";

const env = {
  ...process.env
};

delete env.NODE_USE_SYSTEM_CA;
delete env.NODE_EXTRA_CA_CERTS;

const child = spawn(
  process.execPath,
  ["./node_modules/vitest/vitest.mjs", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
