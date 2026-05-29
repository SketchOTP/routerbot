import assert from "node:assert/strict";
import test from "node:test";
import { parseModels } from "../src/cli.js";
import { loadCodexBundledCatalog } from "../src/codexModels.js";
import { loadGeminiCliModelCatalog } from "../src/geminiModels.js";
import { alignProviderModel, parseCodexModelsCatalog } from "../src/modelList.js";

test("alignProviderModel clears stale selection not in provider list", () => {
  const providerConfig = { model: "fake-model" };
  const models = [{ id: "gpt-5.3-codex", name: "Codex 5.3" }];
  const aligned = alignProviderModel(providerConfig, models);
  assert.deepEqual(aligned, models);
  assert.equal(providerConfig.model, "");
});

test("alignProviderModel does not inject synthetic models", () => {
  const providerConfig = { model: "real" };
  const aligned = alignProviderModel(providerConfig, [{ id: "other", name: "Other" }]);
  assert.equal(aligned.length, 1);
  assert.equal(providerConfig.model, "");
});

test("parseCodexModelsCatalog reads slug entries", () => {
  const models = parseCodexModelsCatalog(
    JSON.stringify([
      { slug: "gpt-5.3-codex", display_name: "Codex 5.3" },
      { slug: "gpt-5.4", display_name: "GPT-5.4" }
    ])
  );
  assert.equal(models.length, 2);
  assert.equal(models[0].id, "gpt-5.3-codex");
});

test("parseModels parses cursor-agent models output", () => {
  const stdout = `Available models

auto - Auto (current)
gpt-5.3-codex - Codex 5.3
composer-2.5 - Composer 2.5`;
  const models = parseModels("cursor", stdout);
  assert.deepEqual(
    models.map((model) => model.id),
    ["auto", "gpt-5.3-codex", "composer-2.5"]
  );
});

test("loadGeminiCliModelCatalog does not inject alias placeholders", () => {
  const models = loadGeminiCliModelCatalog("gemini");
  if (!models) {
    return;
  }
  for (const model of models) {
    assert.ok(!model.name.endsWith("(alias)"), `unexpected alias placeholder: ${model.name}`);
  }
  assert.ok(!models.some((model) => model.id === "auto" && model.name.includes("(alias)")));
});

test("loadCodexBundledCatalog returns slugs from installed binary when present", () => {
  const models = loadCodexBundledCatalog("codex");
  if (!models.length) {
    return;
  }
  assert.ok(models.some((model) => model.id.includes("codex") || model.id.startsWith("gpt-")));
});
