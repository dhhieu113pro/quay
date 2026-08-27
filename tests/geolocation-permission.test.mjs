import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopVite = readFileSync(new URL("../vite.desktop.config.ts", import.meta.url), "utf8");

test("desktop dev origin explicitly denies geolocation permission", () => {
  assert.match(desktopVite, /Permissions-Policy/);
  assert.match(desktopVite, /geolocation=\(\)/);
});
