import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inspect = readFileSync(new URL("../src/components/container-inspect.tsx", import.meta.url), "utf8");
const editorUrl = new URL("../src/lib/wslc/existing-container-env.ts", import.meta.url);
const editor = readFileSync(editorUrl, "utf8");
const editorModule = await import(editorUrl);

test("existing container inspector exposes an Environment editor with recreation warning", () => {
  assert.match(inspect, /TabsTrigger value="environment"/);
  assert.match(inspect, /Environment changes require container recreation/);
  assert.match(inspect, /Save & recreate/);
});

test("existing container inspector lets users edit host ports and recreate safely", () => {
  assert.match(inspect, /PortBindingEditor/);
  assert.match(inspect, /Port changes require container recreation/);
  assert.match(inspect, /hasPublishedHostPortErrors/);
  assert.match(inspect, /updated ports/);
});

test("existing container environment is loaded from container inspect data", () => {
  const parsed = editorModule.parseExistingContainerInspect({
    Name: "/demo",
    Config: { Image: "demo:latest", Env: ["ONE=1", "TWO=2"], WorkingDir: "/app", Cmd: ["serve"] },
    HostConfig: { PortBindings: { "8080/tcp": [{ HostPort: "9000" }] } },
    Mounts: [{ Source: "C:/data", Destination: "/data", RW: false }],
  });
  assert.equal(parsed.name, "demo");
  assert.equal(parsed.image, "demo:latest");
  assert.equal(parsed.env, "ONE=1\nTWO=2");
  assert.equal(parsed.ports, "9000:8080");
  assert.equal(parsed.mounts, "C:/data:/data:ro");
  assert.equal(parsed.workdir, "/app");
  assert.equal(parsed.command, "serve");
  assert.match(inspect, /loadExistingContainerConfig/);
});

test("running container env save stops, removes, recreates, and remains running", async () => {
  const calls = [];
  const config = { name: "demo", image: "demo:latest", command: "", ports: "", env: "OLD=1", mounts: "", workdir: "/", gpu: false };
  await editorModule.recreateContainerWithEnv(config, "NEW=2", true, async (args) => { calls.push(args); return { ok: true }; });
  assert.deepEqual(calls[0], ["container", "stop", "demo"]);
  assert.deepEqual(calls[1], ["container", "rm", "demo"]);
  assert.deepEqual(calls[2].slice(0, 4), ["run", "-d", "--name", "demo"]);
  assert.ok(calls[2].includes("NEW=2"));
  assert.equal(calls.length, 3, "detached run recreates and starts the replacement");
});

test("stopped container env save recreates then restores stopped state", async () => {
  const calls = [];
  const config = { name: "demo", image: "demo:latest", command: "", ports: "", env: "", mounts: "", workdir: "/", gpu: false };
  await editorModule.recreateContainerWithEnv(config, "NEW=2", false, async (args) => { calls.push(args); return { ok: true }; });
  assert.deepEqual(calls[0], ["container", "rm", "demo"]);
  assert.deepEqual(calls[1].slice(0, 4), ["run", "-d", "--name", "demo"]);
  assert.deepEqual(calls[2], ["container", "stop", "demo"]);
});

test("Cube inherited environment remains read-only while custom container env stays editable", () => {
  assert.match(inspect, /inheritedRows/);
  assert.match(inspect, /withoutEnvKeys/);
  assert.match(inspect, /<EnvEditor rows=\{rows\} inheritedRows=\{inheritedRows\}/);
});

test("existing container recreation helper fails fast when a lifecycle command fails", async () => {
  const config = { name: "demo", image: "demo:latest", command: "", ports: "", env: "", mounts: "", workdir: "/", gpu: false };
  await assert.rejects(
    () => editorModule.recreateContainerWithEnv(config, "", true, async (args) => args[0] === "container" && args[1] === "stop" ? { ok: false, error: "stop failed" } : { ok: true }),
    /stop failed/,
  );
  assert.match(editor, /existingContainerRunArgs/);
});
