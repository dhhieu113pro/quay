import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRuntimeEnvDefaults,
  missingRequiredEnv,
  runtimeEnvForImage,
  runtimeEnvSourceByKey,
} from "../src/lib/wslc/image-runtime-env.ts";

const image = "ghcr.io/dhhieu113pro/github-refollow:latest";

test("github-refollow exposes its documented runtime environment suggestions", () => {
  assert.deepEqual(runtimeEnvForImage(image), [
    { key: "GITHUB_REFOLLOW_TOKEN", value: "", source: "Required", required: true },
    { key: "GITHUB_REFOLLOW_API_KEY", value: "", source: "Suggested" },
    { key: "GITHUB_REFOLLOW_DRY_RUN", value: "true", source: "Image default" },
    { key: "GITHUB_REFOLLOW_DELAY_SECONDS", value: "2", source: "Image default" },
    { key: "TZ", value: "Asia/Ho_Chi_Minh", source: "Image default" },
  ]);
});

test("github-refollow requires only the GitHub token while preserving documented defaults", () => {
  const defaults = applyRuntimeEnvDefaults("", image);

  assert.match(defaults, /GITHUB_REFOLLOW_TOKEN=/);
  assert.match(defaults, /GITHUB_REFOLLOW_API_KEY=/);
  assert.match(defaults, /GITHUB_REFOLLOW_DRY_RUN=true/);
  assert.match(defaults, /GITHUB_REFOLLOW_DELAY_SECONDS=2/);
  assert.match(defaults, /TZ=Asia\/Ho_Chi_Minh/);
  assert.deepEqual(missingRequiredEnv(defaults, image), ["GITHUB_REFOLLOW_TOKEN"]);

  const sources = runtimeEnvSourceByKey(image);
  assert.equal(sources.GITHUB_REFOLLOW_TOKEN, "Required");
  assert.equal(sources.GITHUB_REFOLLOW_API_KEY, "Suggested");
});
