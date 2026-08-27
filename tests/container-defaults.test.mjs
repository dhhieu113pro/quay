import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runDialog = readFileSync(new URL("../src/components/run-dialog.tsx", import.meta.url), "utf8");
const cubeDialog = readFileSync(new URL("../src/components/cube-container-dialog.tsx", import.meta.url), "utf8");
const defaults = readFileSync(new URL("../src/lib/wslc/container-defaults.ts", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const inspect = readFileSync(new URL("../src/components/container-inspect.tsx", import.meta.url), "utf8");
const cloneCubeDialog = readFileSync(new URL("../src/components/clone-cube-dialog.tsx", import.meta.url), "utf8");
const cloneContainerDialog = readFileSync(new URL("../src/components/clone-container-dialog.tsx", import.meta.url), "utf8");
const envEditor = readFileSync(new URL("../src/components/kv-editor.tsx", import.meta.url), "utf8");
let cloneSource = "";
let runtimeEnv = "";
let runtimeEnvModule = null;
let imageInspectDefaults = "";
let imageInspectClient = "";
let imageInspectModule = null;
try { cloneSource = readFileSync(new URL("../src/lib/wslc/clone.ts", import.meta.url), "utf8"); } catch { /* RED until implementation exists */ }
try {
  const runtimeEnvUrl = new URL("../src/lib/wslc/image-runtime-env.ts", import.meta.url);
  runtimeEnv = readFileSync(runtimeEnvUrl, "utf8");
  runtimeEnvModule = await import(runtimeEnvUrl);
} catch { /* RED until implementation exists */ }
try {
  const imageInspectUrl = new URL("../src/lib/wslc/image-inspect-defaults.ts", import.meta.url);
  imageInspectDefaults = readFileSync(imageInspectUrl, "utf8");
  imageInspectModule = await import(imageInspectUrl);
  imageInspectClient = readFileSync(new URL("../src/lib/wslc/image-inspect-client.ts", import.meta.url), "utf8");
} catch { /* RED until implementation exists */ }

test("container image defaults derive a safe name and reuse trusted catalog presets", () => {
  assert.match(defaults, /containerNameFromImage/);
  assert.match(defaults, /catalogPresets\.find/);
  assert.match(defaults, /applyImageDefaults/);
});

test("standalone Run Container applies image defaults without overwriting a custom name", () => {
  assert.match(runDialog, /applyImageDefaults/);
  assert.match(runDialog, /onChange=\{\(event\) => applyImage/);
  assert.match(runDialog, /nameTouched/);
});

test("standalone and Cube dialogs seed an editable environment row when none exists", () => {
  assert.match(runDialog, /editableEnvRows/);
  assert.match(cubeDialog, /editableEnvRows/);
});

test("Cube container image changes use the same runnable defaults helper", () => {
  assert.match(cubeDialog, /applyImageDefaults/);
  assert.match(cubeDialog, /onChange=\{\(event\) => applyImage/);
});

test("trusted runtime environment rules cover common images", () => {
  assert.match(runtimeEnv, /postgres/);
  assert.match(runtimeEnv, /POSTGRES_PASSWORD/);
  assert.match(runtimeEnv, /mysql/);
  assert.match(runtimeEnv, /MYSQL_ROOT_PASSWORD/);
  assert.match(runtimeEnv, /mariadb/);
  assert.match(runtimeEnv, /MARIADB_ROOT_PASSWORD/);
  assert.match(runtimeEnv, /ngrok/);
  assert.match(runtimeEnv, /NGROK_AUTHTOKEN/);
  assert.match(runtimeEnv, /local-coding-mcp/);
});

test("automatic environment merge preserves existing user values", () => {
  assert.ok(runtimeEnvModule, "runtime environment helper must load");
  const merged = runtimeEnvModule.applyRuntimeEnvDefaults("POSTGRES_USER=custom-user\nPOSTGRES_PASSWORD=secret", "postgres:16");
  assert.match(merged, /POSTGRES_USER=custom-user/);
  assert.match(merged, /POSTGRES_PASSWORD=secret/);
  assert.match(merged, /POSTGRES_DB=app/);
});

test("known required environment variables block submission until populated", () => {
  assert.ok(runtimeEnvModule, "runtime environment helper must load");
  assert.deepEqual(runtimeEnvModule.missingRequiredEnv("NGROK_AUTHTOKEN=", "ngrok:latest"), ["NGROK_AUTHTOKEN"]);
  assert.deepEqual(runtimeEnvModule.missingRequiredEnv("NGROK_AUTHTOKEN=token-value", "ngrok:latest"), []);
  assert.match(runDialog, /disabled=\{busy \|\| !spec\.image\.trim\(\) \|\| missing\.length > 0\}/);
  assert.match(runDialog, /if \(busy \|\| missing\.length\) return/);
  assert.match(cubeDialog, /disabled=\{missing\.length > 0\}/);
  assert.match(cubeDialog, /if \(missing\.length\)/);
});

test("Run Container and Cube member dialogs automatically apply runtime environment defaults", () => {
  assert.match(runDialog, /applyRuntimeEnvDefaults/);
  assert.match(runDialog, /requiredEnvKeys/);
  assert.match(cubeDialog, /applyRuntimeEnvDefaults/);
});

test("image inspect parsing filters noisy ENV and reads safe OCI defaults", () => {
  assert.ok(imageInspectModule, "image inspect helper must load");
  const parsed = imageInspectModule.parseImageInspect(JSON.stringify([{
    Config: {
      Env: ["PATH=/usr/local/bin:/usr/bin", "APP_MODE=production"],
      ExposedPorts: { "8080/tcp": {}, "5353/udp": {} },
      WorkingDir: "/app",
      Entrypoint: ["/entrypoint"],
      Cmd: ["serve"],
      Volumes: { "/data": {} },
    },
  }]));
  assert.deepEqual(parsed.env, { APP_MODE: "production" });
  assert.deepEqual(parsed.exposedPorts, ["8080/tcp", "5353/udp"]);
  assert.equal(parsed.workingDir, "/app");
  assert.deepEqual(parsed.entrypoint, ["/entrypoint"]);
  assert.deepEqual(parsed.cmd, ["serve"]);
  assert.deepEqual(parsed.volumes, ["/data"]);
});

test("image inspect defaults preserve explicit user env ports and workdir", () => {
  assert.ok(imageInspectModule, "image inspect helper must load");
  const inspected = imageInspectModule.parseImageInspect({ Config: { Env: ["APP_MODE=image", "IMAGE_ONLY=yes"], ExposedPorts: { "8080/tcp": {} }, WorkingDir: "/image" } });
  const merged = imageInspectModule.applyImageInspectDefaults({ env: "APP_MODE=user", ports: "9090:90", workdir: "/custom", marker: true }, inspected);
  assert.equal(merged.env, "APP_MODE=user\nIMAGE_ONLY=yes");
  assert.equal(merged.ports, "9090:90");
  assert.equal(merged.workdir, "/custom");
  assert.equal(merged.marker, true);
  const defaultsApplied = imageInspectModule.applyImageInspectDefaults({ env: "", ports: "", workdir: "/" }, inspected);
  assert.equal(defaultsApplied.ports, "8080:8080");
  assert.equal(defaultsApplied.workdir, "/image");
});

test("image inspect cache reuses successful metadata and failures stay non-blocking", async () => {
  assert.ok(imageInspectModule, "image inspect helper must load");
  imageInspectModule.imageInspectCache.clear();
  let loads = 0;
  const load = async () => { loads += 1; return JSON.stringify({ Config: { Env: ["ONE=1"] } }); };
  const first = await imageInspectModule.inspectImage("demo:latest", load);
  const second = await imageInspectModule.inspectImage("demo:latest", load);
  assert.equal(loads, 1);
  assert.deepEqual(first, second);
  let failures = 0;
  const missing = await imageInspectModule.inspectImage("missing:latest", async () => { failures += 1; throw new Error("not found"); });
  const retried = await imageInspectModule.inspectImage("missing:latest", async () => { failures += 1; return null; });
  assert.equal(missing, null);
  assert.equal(retried, null);
  assert.equal(failures, 2);
});

test("Run Container and Cube members inspect pulled images then reapply trusted required defaults", () => {
  assert.match(imageInspectDefaults, /parseImageInspect/);
  assert.match(imageInspectDefaults, /applyImageInspectDefaults/);
  assert.match(imageInspectDefaults, /imageInspectCache/);
  assert.match(imageInspectClient, /\["image", "inspect", image\]/);
  assert.match(runDialog, /inspectImage/);
  assert.match(runDialog, /applyImageInspectDefaults/);
  assert.match(runDialog, /applyRuntimeEnvDefaults\(inspectedSpec\.env, image\)/);
  assert.match(cubeDialog, /inspectImage/);
  assert.match(cubeDialog, /applyImageInspectDefaults/);
  assert.match(cubeDialog, /applyRuntimeEnvDefaults\(inspectedSpec\.env, image\)/);
});

test("environment editor can mark auto-generated rows by source and required state", () => {
  assert.match(envEditor, /sourceByKey/);
  assert.match(envEditor, /requiredKeys/);
  assert.match(envEditor, /Required/);
  assert.match(envEditor, /Image default/);
});

test("clone helpers generate collision-safe identities and regenerated Cube infrastructure", () => {
  assert.match(cloneSource, /nextCloneName/);
  assert.match(cloneSource, /cloneCubeDraft/);
  assert.match(cloneSource, /cloneContainerSpec/);
  assert.match(cloneSource, /cubeNetworkName/);
  assert.match(cloneSource, /defaultCubeWorkspacePath/);
});

test("Clone Cube dialog only exposes identity editing", () => {
  assert.match(groupsView, /Clone Cube/);
  assert.match(groupsView, /CloneCubeDialog/);
  assert.match(cloneCubeDialog, /Save Clone/);
  assert.match(cloneCubeDialog, /readOnly/);
});

test("Clone Container dialog only exposes identity editing", () => {
  assert.match(inspect, /CloneContainerDialog/);
  assert.match(cloneContainerDialog, /Create Clone/);
  assert.match(cloneContainerDialog, /readOnly/);
});
