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

test("image command suggestion combines entrypoint and cmd without overwriting custom command", () => {
  assert.equal(typeof inspectModule.imageCommandSuggestion, "function");
  const inspect = { env: {}, exposedPorts: [], workingDir: "", entrypoint: ["/entrypoint.sh"], cmd: ["serve", "--port", "8080"], volumes: [] };
  assert.equal(inspectModule.imageCommandSuggestion(inspect), "/entrypoint.sh serve --port 8080");
  assert.equal(inspectModule.applyImageCommandSuggestion("custom --flag", inspect), "custom --flag");
  assert.equal(inspectModule.applyImageCommandSuggestion("", inspect), "/entrypoint.sh serve --port 8080");
});

test("image volume suggestions require an explicit host source and prevent duplicate destinations", () => {
  assert.equal(typeof inspectModule.addImageVolumeMount, "function");
  const inspect = { env: {}, exposedPorts: [], workingDir: "", entrypoint: [], cmd: [], volumes: ["/data"] };
  assert.deepEqual(inspectModule.imageVolumeSuggestions(inspect), ["/data"]);
  const rows = [{ id: "one", source: "workspace/data", destination: "/data", mode: "rw" }];
  assert.deepEqual(inspectModule.addImageVolumeMount(rows, "", "/cache"), rows, "empty host source must not create a mount");
  assert.deepEqual(inspectModule.addImageVolumeMount(rows, "workspace/other", "/data"), rows, "duplicate destination must not be added");
  const added = inspectModule.addImageVolumeMount(rows, "workspace/cache", "/cache");
  assert.equal(added.length, 2);
  assert.equal(added[1].source, "workspace/cache");
  assert.equal(added[1].destination, "/cache");
});

test("Run Container and Cube member flows expose image-default command and volume actions", () => {
  for (const source of [runDialog, cubeDialog]) {
    assert.match(source, /Image defaults/);
    assert.match(source, /Use command/);
    assert.match(source, /Add mount/);
    assert.match(source, /imageCommandSuggestion/);
    assert.match(source, /addImageVolumeMount/);
  }
});

test("image inspect parser normalizes OCI healthcheck and filters useful labels", () => {
  const parsed = inspectModule.parseImageInspect({ Config: {
    Labels: {
      "org.opencontainers.image.title": "Example API",
      "org.opencontainers.image.description": "Example service",
      "org.opencontainers.image.version": "1.2.3",
      "org.opencontainers.image.source": "https://example.invalid/source",
      "org.opencontainers.image.vendor": "Example Corp",
      "com.docker.compose.project": "noise",
      "build.timestamp": "noise",
    },
    Healthcheck: {
      Test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
      Interval: 30000000000,
      Timeout: 5000000000,
      Retries: 3,
      StartPeriod: 10000000000,
    },
  } });
  assert.deepEqual(parsed.labels, {
    title: "Example API",
    description: "Example service",
    version: "1.2.3",
    source: "https://example.invalid/source",
    vendor: "Example Corp",
  });
  assert.deepEqual(parsed.healthcheck, {
    test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
    intervalMs: 30000,
    timeoutMs: 5000,
    retries: 3,
    startPeriodMs: 10000,
  });
});

test("readiness metadata is display-only unless runtime support is explicitly available", () => {
  assert.equal(typeof inspectModule.imageReadinessMetadata, "function");
  const metadata = inspectModule.imageReadinessMetadata({
    env: {}, exposedPorts: [], workingDir: "", entrypoint: [], cmd: [], volumes: [],
    labels: { title: "Worker", version: "2.0" },
    healthcheck: { test: ["CMD", "check"], intervalMs: 1000, timeoutMs: 500, retries: 2, startPeriodMs: 0 },
  });
  assert.equal(metadata.title, "Worker");
  assert.equal(metadata.version, "2.0");
  assert.equal(metadata.healthcheck?.retries, 2);
});

test("Run Container and Cube member flows display image readiness metadata", () => {
  for (const source of [runDialog, cubeDialog]) {
    assert.match(source, /Healthcheck/);
    assert.match(source, /Image labels/);
    assert.match(source, /imageReadinessMetadata/);
  }
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
    exposedPorts: [], workingDir: "", entrypoint: [], cmd: [], volumes: [], labels: {}, healthcheck: null,
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

test("published ports allow editing only the outside host port", () => {
  assert.equal(typeof inspectModule.publishedPortRows, "function");
  assert.equal(typeof inspectModule.updatePublishedHostPort, "function");
  assert.deepEqual(inspectModule.publishedPortRows("8080:80,5353:53/udp"), [
    { hostPort: "8080", containerPort: "80", protocol: "tcp" },
    { hostPort: "5353", containerPort: "53", protocol: "udp" },
  ]);
  assert.equal(
    inspectModule.updatePublishedHostPort("8080:80,5353:53/udp", 0, "9090"),
    "9090:80,5353:53/udp",
  );
  assert.equal(
    inspectModule.updatePublishedHostPort("8080:80,5353:53/udp", 1, "5354"),
    "8080:80,5354:53/udp",
  );
});

test("Run Container and Cube member flows use a compact host-only port editor", () => {
  const portEditor = read("../src/components/port-binding-editor.tsx");
  assert.match(portEditor, /Host port/);
  assert.match(portEditor, /Container port/);
  assert.match(portEditor, /readOnly/);
  assert.doesNotMatch(portEditor, /Add port|Remove port/);
  for (const source of [runDialog, cubeDialog]) assert.match(source, /PortBindingEditor/);
  assert.doesNotMatch(runDialog, /htmlFor="ports"|id="ports"/);
  assert.doesNotMatch(cubeDialog, /htmlFor="cube-container-ports"|id="cube-container-ports"/);
});