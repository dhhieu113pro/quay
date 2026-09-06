import assert from "node:assert/strict";
import test from "node:test";

const runtimeEnv = await import(new URL("../src/lib/wslc/image-runtime-env.ts", import.meta.url));

const image = "ghcr.io/dhhieu113pro/ai-router:latest";

test("AI Router suggests its admin key as required runtime configuration", () => {
  assert.deepEqual(runtimeEnv.runtimeEnvForImage(image), [
    { key: "AIROUTER_ADMIN_KEY", value: "", source: "Required", required: true },
    { key: "AIROUTER_API_KEY", value: "", source: "Image default" },
  ]);

  assert.equal(
    runtimeEnv.applyRuntimeEnvDefaults("", image),
    "AIROUTER_ADMIN_KEY=\nAIROUTER_API_KEY=",
  );
  assert.deepEqual(runtimeEnv.missingRequiredEnv("AIROUTER_ADMIN_KEY=\nAIROUTER_API_KEY=", image), ["AIROUTER_ADMIN_KEY"]);
  assert.deepEqual(runtimeEnv.missingRequiredEnv("AIROUTER_ADMIN_KEY=secret\nAIROUTER_API_KEY=", image), []);
});
