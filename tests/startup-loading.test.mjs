import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("desktop startup renders a Quay-shaped skeleton before route content is ready", () => {
  assert.match(root, /StartupSkeleton/);
  assert.match(root, /aria-label="Loading Quay"/);
  assert.match(root, /animate-pulse/);
  assert.match(root, /motion-reduce:animate-none/);
  assert.match(root, /data-startup-skeleton/);
});

test("startup skeleton follows the app appearance instead of flashing white", () => {
  assert.match(root, /bg-background/);
  assert.match(root, /text-foreground/);
  assert.match(root, /APPEARANCE_BOOT/);
});

test("Tauri dev URL matches the IPv4 host used by Vite", () => {
  assert.equal(tauri.build.devUrl, "http://127.0.0.1:8080");
  assert.match(pkg.scripts.dev, /--host 127\.0\.0\.1 --port 8080/);
});
