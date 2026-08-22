import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  [
    "./node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "vite.desktop.config.ts",
  ],
  { stdio: "inherit" },
);
if (result.status) process.exit(result.status ?? 1);

const shell = "dist/client/_shell.html";
const index = "dist/client/index.html";
if (existsSync(shell) && !existsSync(index)) {
  copyFileSync(shell, index);
}
if (!existsSync(index)) {
  console.error("desktop build: missing dist/client/index.html");
  process.exit(1);
}
console.log("desktop shell → dist/client/index.html");
