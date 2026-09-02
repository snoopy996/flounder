import assert from "node:assert/strict";
import test from "node:test";
import { resolvePiModel } from "../dist/llm/model-resolver.js";

test("custom model aliases keep pi transport metadata but send the custom wire id", () => {
  const base = resolvePiModel("openai-codex", "gpt-5.6-sol");
  assert.ok(base, "the pinned pi catalog must contain the product default");

  const alias = resolvePiModel("openai-codex", "gpt-daybreak-blue-latest", [
    { provider: "openai-codex", model: "gpt-daybreak-blue-latest", baseModel: "gpt-5.6-sol" },
  ]);
  assert.ok(alias);
  assert.equal(alias.id, "gpt-daybreak-blue-latest");
  assert.equal(alias.provider, base.provider);
  assert.equal(alias.api, base.api);
  assert.equal(alias.baseUrl, base.baseUrl);
  assert.equal(alias.contextWindow, base.contextWindow);
  assert.deepEqual(alias.thinkingLevelMap, base.thinkingLevelMap);
});

test("custom model aliases fail closed when their compatibility base is unknown", () => {
  assert.equal(resolvePiModel("openai-codex", "private-model", [
    { provider: "openai-codex", model: "private-model", baseModel: "missing-base" },
  ]), undefined);
});
