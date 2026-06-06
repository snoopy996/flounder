import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const configDir = path.join(root, "configs");

test("default hunting config templates are publication-safe and model-backed", async () => {
  const files = (await readdir(configDir)).filter((file) => file.endsWith(".json"));
  assert.ok(files.includes("vulnerability-hunt.default.json"));
  assert.ok(files.includes("zk-constraint-hunt.default.json"));

  for (const file of files) {
    const body = await readFile(path.join(configDir, file), "utf8");
    const config = JSON.parse(body);
    assert.equal(body.includes(root), false, `${file} includes a local absolute path`);
    assert.deepEqual(config.sourcePaths, [], `${file} should not publish target-local source paths`);
    assert.deepEqual(config.corpusPaths, [], `${file} should not publish target-local corpus paths`);
    assert.equal(config.localChecklistSeeders, false, `${file} must keep local seeders disabled for live discovery`);
    assert.equal(config.projectLearning, true, `${file} should learn target context before enumeration`);
    assert.equal(config.dynamicLensDiscovery, true, `${file} should discover target-specific lenses`);
    assert.equal(config.portfolioEnumeration, true, `${file} should keep portfolio enumeration enabled`);
    assert.equal(config.reproductionMode, "off", `${file} should not run or plan PoC by default`);
    assert.ok(config.rounds >= 2, `${file} should leave budget for deepening rounds`);
    assert.ok(config.trials >= 4, `${file} should use multiple audit trials`);
    assert.ok(config.maxAuditItems > config.maxNewItemsPerRound, `${file} should reserve budget across rounds`);
  }
});
