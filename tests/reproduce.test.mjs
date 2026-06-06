import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../dist/config.js";
import { loadSource } from "../dist/ingest/source.js";
import { reproduceTop } from "../dist/reproduce/planner.js";
import { RunLogger } from "../dist/trace/logger.js";

test("reproduction execute mode writes and runs PoC only in a copied workspace", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "fsa-repro-project-"));
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "target.js"), "export function vulnerable() { return true; }\n");
  const out = await mkdtemp(path.join(os.tmpdir(), "fsa-repro-run-"));
  const cfg = defaultConfig();
  cfg.targetName = "repro-test";
  cfg.sourcePaths = [project];
  cfg.outputDir = out;
  cfg.reproductionMode = "execute";
  cfg.reproductionCommandTimeoutMs = 30_000;
  const logger = new RunLogger(cfg.outputDir, cfg.targetName);
  await logger.init();
  const source = await loadSource(cfg.sourcePaths);

  const reproductions = await reproduceTop({
    cfg,
    findings: [
      {
        id: "mock-finding",
        location: "src/target.js:1",
        failureMode: "input_validation",
        title: "Mock executable finding",
        severity: "high",
        hitRate: 1,
        confidence: 0.9,
        score: 10,
        description: "A mock finding used to exercise the local reproduction runner.",
        evidence: "The mock source contains a visible test target.",
        exploitSketch: "A local test can demonstrate the behavior.",
        fix: "Add the missing check.",
        confirmationStatus: "confirmed-source",
      },
    ],
    verifications: [
      {
        id: "mock-finding",
        verdict: "confirmed",
        confirmationStatus: "confirmed-source",
        markdown: "VERDICT: confirmed\n\nSource-level mock confirmation.",
      },
    ],
    source,
    llm: new ReproductionOnlyLlm(),
    logger,
    topK: 1,
  });

  assert.equal(reproductions.length, 1);
  assert.equal(reproductions[0].status, "confirmed-executable");
  assert.equal(reproductions[0].confirmationStatus, "confirmed-executable");
  assert.equal(reproductions[0].commandResults[0].exitCode, 0);
  assert.equal(await exists(path.join(project, "repro.test.mjs")), false);

  const artifact = await readFile(path.join(logger.runDir, "reproductions.json"), "utf8");
  assert.equal(artifact.includes(project), false);
  assert.equal(artifact.includes(out), false);
  assert.match(artifact, /"workspace": "reproduction\/mock-finding\/workspace"/);
});

class ReproductionOnlyLlm {
  async complete() {
    return JSON.stringify({
      summary: "Create a local node test that proves the reproduction runner can execute inside the copied workspace.",
      files: [
        {
          path: "repro.test.mjs",
          content:
            "import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('local reproduction command runs in workspace', () => {\n  assert.equal(2 + 2, 4);\n});\n",
        },
      ],
      commands: [
        {
          program: "node",
          args: ["--test", "repro.test.mjs"],
          cwd: ".",
          timeoutMs: 30000,
          expectedExitCode: 0,
        },
      ],
      successCriteria: ["node --test exits with status 0 in the copied workspace"],
      safetyNotes: ["local node test only"],
    });
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
