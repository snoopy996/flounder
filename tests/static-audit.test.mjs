import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../dist/config.js";
import { loadCorpus, loadSource } from "../dist/ingest/source.js";
import { runPipeline } from "../dist/pipeline.js";
import { runStaticAuditors } from "../dist/audit/static.js";
import { runSeeders } from "../dist/seeders/index.js";

test("static impact inference uses neutral corpus semantics for system-level severity", async () => {
  const source = await loadSource([path.resolve("fixtures/halo2_scalar_mul_binding.rs")]);
  const corpus = await loadCorpus([path.resolve("fixtures/generic_spend_marker_spec.txt")]);
  const items = runSeeders(source);
  const results = runStaticAuditors(items, [...source, ...corpus]);
  const finding = results.find((result) => result.nHits > 0)?.trials[0];

  assert.equal(finding?.severity, "critical");
  assert.match(finding?.description ?? "", /spend-marker uniqueness/);
  assert.match(finding?.description ?? "", /value conservation/);
  assert.match(finding?.exploitSketch ?? "", /multiple accepted spend markers/);
});

test("pipeline dry-run promotes neutral binding risk to critical when corpus proves impact chain", async () => {
  const cfg = defaultConfig();
  cfg.targetName = "neutral-impact";
  cfg.sourcePaths = [path.resolve("fixtures/halo2_scalar_mul_binding.rs")];
  cfg.corpusPaths = [path.resolve("fixtures/generic_spend_marker_spec.txt")];
  cfg.outputDir = await mkTempOutput();
  cfg.dryRun = true;

  const result = await runPipeline(cfg);
  assert.equal(result.summary.coverage.itemsWithFinding, 1);
  assert.equal(result.summary.coverage.bySeverity.critical, 1);
  assert.match(result.summary.findings[0].description, /system-level accounting invariant/);
});

async function mkTempOutput() {
  return mkdtemp(path.join(os.tmpdir(), "fsa-impact-"));
}
