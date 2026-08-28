import assert from "node:assert/strict";
import test from "node:test";

const runtimeEnvModule = await import(new URL("../src/lib/wslc/image-runtime-env.ts", import.meta.url));

const { runtimeEnvForImage, requiredEnvKeys, missingRequiredEnv } = runtimeEnvModule;

test("official Docker Hub aliases share trusted runtime env rules", () => {
  for (const image of [
    "postgres:16",
    "docker.io/library/postgres:16",
    "index.docker.io/library/postgres:16",
    "POSTGRES:16",
  ]) {
    assert.ok(runtimeEnvForImage(image).some((row) => row.key === "POSTGRES_PASSWORD"), image);
    assert.ok(requiredEnvKeys(image).has("POSTGRES_PASSWORD"), image);
  }
});

test("tags and digests do not change trusted image identity", () => {
  const digest = "sha256:" + "a".repeat(64);
  assert.ok(requiredEnvKeys(`docker.io/library/postgres@${digest}`).has("POSTGRES_PASSWORD"));
  assert.ok(requiredEnvKeys("ngrok/ngrok:3.18.0").has("NGROK_AUTHTOKEN"));
});

test("third-party lookalikes never receive trusted required env rules", () => {
  for (const image of [
    "ghcr.io/example/postgres:latest",
    "example/postgres:16",
    "quay.io/example/mysql:8",
    "docker.io/example/mariadb:11",
    "ghcr.io/example/ngrok:latest",
    "ngrok:latest",
  ]) {
    assert.deepEqual(runtimeEnvForImage(image), [], image);
    assert.equal(requiredEnvKeys(image).size, 0, image);
    assert.deepEqual(missingRequiredEnv("", image), [], image);
  }
});

test("LocalCoding rules require the exact trusted GHCR repository", () => {
  const trusted = "ghcr.io/dhhieu113pro/local-coding-mcp:latest";
  assert.ok(runtimeEnvForImage(trusted).some((row) => row.key === "AllowedRoots__0"));
  assert.deepEqual(runtimeEnvForImage("local-coding-mcp:latest"), []);
  assert.deepEqual(runtimeEnvForImage("ghcr.io/example/local-coding-mcp:latest"), []);
});
