import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => {
  try { return readFileSync(new URL(path, import.meta.url), "utf8"); }
  catch { return ""; }
};

const inspectDefaults = read("../src/lib/wslc/image-inspect-defaults.ts");
const runDialog = read("../src/components/run-dialog.tsx");
const cubeDialog = read("../src/components/cube-container-dialog.tsx");
const inspectModule = await import(new URL("../src/lib/wslc/image-inspect-defaults.ts", import.meta.url));
const runtimeModule = await import(new URL("../src/lib/wslc/image-runtime-env.ts", import.meta.url));

test("image inspect parser extracts safe runtime defaults", () => {
  const parsed = inspectModule.parseImageInspect(JSON.stringify({ Config: {
    Env: ["PATH=/usr/bin", "APP_MODE=production"],
    ExposedPorts: { "8080/tcp": {}, "5353/udp": {} },
    WorkingDir: "/srv/app",
    Entrypoint: ["/entrypoint.sh"],
    Cmd: ["serve"],
    Volumes: { "/data": {} },
  } }));
  assert.deepEqual(parsed.env, { APP_MODE: "production" });
  assert.deepEqual(parsed.exposedPorts, ["8080/tcp", "5353/udp"]);
  assert.equal(parsed.workingDir, "/srv/app");
  assert.deepEqual(parsed.entrypoint, ["/entrypoint.sh"]);
  assert.deepEqual(parsed.cmd, ["serve"]);
  assert.deepEqual(parsed.volumes, ["/data"]);
});

test("image inspect defaults preserve user env, ports, and workdir", () => {
  const inspect = inspectModule.parseImageInspect({ Config: {
    Env: ["APP_MODE=image", "IMAGE_ONLY=yes"],
    ExposedPorts: { "8080/tcp": {} },
    WorkingDir: "/image-workdir",
  } });
  const merged = inspectModule.applyImageInspectDefaults({
    env: "APP_MODE=user",
    ports: "9000:9000",
    workdir: "/user-workdir",
  }, inspect);
  assert.match(merged.env, /APP_MODE=user/);
  assert.match(merged.env, /IMAGE_ONLY=yes/);
  assert.equal(merged.ports, "9000:9000");
  assert.equal(merged.workdir, "/user-workdir");
});

test("image inspect success is cached and failure remains non-blocking and retryable", async () => {
  inspectModule.imageInspectCache.clear();
  let failures = 0;
  const failed = await inspectModule.inspectImage("example/failing:latest", async () => {
    failures += 1;
    throw new Error("inspect unavailable");
  });
  assert.equal(failed, null);
  assert.equal(failures, 1);
  assert.equal(inspectModule.imageInspectCache.has("example/failing:latest"), false);

  let loads = 0;
  const loader = async () => {
    loads += 1;
    return JSON.stringify({ Config: { Env: ["READY=yes"] } });
  };
  const retry = await inspectModule.inspectImage("example/failing:latest", loader);
  const cached = await inspectModule.inspectImage("example/failing:latest", loader);
  assert.deepEqual(retry?.env, { READY: "yes" });
  assert.deepEqual(cached?.env, { READY: "yes" });
  assert.equal(loads, 1);
});

test("Run Container and Cube member flows request inspect defaults", () => {
  assert.match(runDialog, /inspectImage/);
  assert.match(runDialog, /applyImageInspectDefaults/);
  assert.match(cubeDialog, /inspectImage/);
  assert.match(cubeDialog, /applyImageInspectDefaults/);
});

test("trusted required-env rules remain authoritative over conflicting image metadata", () => {
  const image = "postgres:16";
  const trustedFirst = runtimeModule.applyRuntimeEnvDefaults("", image);
  const inspected = inspectModule.applyImageInspectDefaults({ env: trustedFirst, ports: "", workdir: "/" }, {
    env: { POSTGRES_PASSWORD: "baked-secret", POSTGRES_USER: "image-user" },
    exposedPorts: [], workingDir: "", entrypoint: [], cmd: [], volumes: [],
  });
  const finalEnv = runtimeModule.applyRuntimeEnvDefaults(inspected.env, image);
  assert.match(finalEnv, /POSTGRES_PASSWORD=\n|POSTGRES_PASSWORD=$/m);
  assert.deepEqual(runtimeModule.missingRequiredEnv(finalEnv, image), ["POSTGRES_PASSWORD"]);
  assert.match(finalEnv, /POSTGRES_USER=quay/);
});

test("CI-facing source wiring still keeps inspect and trusted defaults in both dialogs", () => {
  assert.match(inspectDefaults, /parseImageInspect/);
  assert.match(runDialog, /applyRuntimeEnvDefaults/);
  assert.match(runDialog, /applyImageInspectDefaults/);
  assert.match(cubeDialog, /applyRuntimeEnvDefaults/);
  assert.match(cubeDialog, /applyImageInspectDefaults/);
});
