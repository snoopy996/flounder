import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

async function loadTsModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/^import type .*?;\n/gm, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
    reportDiagnostics: true,
  });
  const diagnostics = compiled.diagnostics?.filter((entry) => entry.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(diagnostics, []);
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
}

const {
  canAddWorkItem,
  canCancelRunGroup,
  canPauseRunGroup,
  canRetryWorkItem,
  canStartRunGroup,
  evaluationMetrics,
  groupStateTone,
  harnessExperimentLabel,
  harnessExperimentTone,
  workItemStateLabel,
  workItemTone,
} = await loadTsModule("../src/server/ui/src/evaluation-domain.ts");
const evaluationViewSource = readFileSync(new URL("../src/server/ui/src/EvaluationsView.tsx", import.meta.url), "utf8");
const harnessViewSource = readFileSync(new URL("../src/server/ui/src/HarnessExperimentsView.tsx", import.meta.url), "utf8");

function item(overrides = {}) {
  return {
    id: 1,
    uuid: "item-1",
    run_group_id: 1,
    item_key: "case-1",
    kind: "benchmark-case",
    state: "finished",
    outcome: "findings_reported",
    attempts: 1,
    targetBundle: { target: "fixture", targetClass: "general", sourcePaths: ["src"], corpusPaths: [] },
    materialPolicy: { posture: "blind", materials: [] },
    evidenceContract: { kind: "benchmark-oracle", requiresDifferential: true, requiresRefutation: true, networkPolicy: "sealed", expectedOutcome: "detect-positive" },
    result: { accepted: true },
    attemptHistory: [],
    ...overrides,
  };
}

function group(items, state = "finished") {
  return { id: 1, uuid: "group-1", name: "Regression", kind: "benchmark", state, parallelism: 2, items };
}

test("ui evaluations: blocked and invalid items never enter the score", () => {
  const metrics = evaluationMetrics(group([
    item(),
    item({ id: 2, uuid: "item-2", item_key: "miss", result: { accepted: false }, outcome: "no_findings" }),
    item({ id: 3, uuid: "item-3", item_key: "infra", state: "failed", outcome: "blocked", result: { accepted: false } }),
    item({ id: 4, uuid: "item-4", item_key: "invalid", outcome: "invalid", result: { accepted: false } }),
  ]));
  assert.equal(metrics.total, 4);
  assert.equal(metrics.completed, 4);
  assert.equal(metrics.blocked, 1);
  assert.equal(metrics.invalid, 1);
  assert.equal(metrics.scored, 2);
  assert.equal(metrics.passed, 1);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.passRate, 0.5);
});

test("ui evaluations: positive recall and control pass remain separate", () => {
  const metrics = evaluationMetrics(group([
    item(),
    item({ id: 2, uuid: "item-2", item_key: "positive-miss", result: { accepted: false }, outcome: "no_findings" }),
    item({ id: 3, uuid: "item-3", item_key: "safe-control", outcome: "no_findings", evidenceContract: { kind: "benchmark-oracle", requiresDifferential: false, requiresRefutation: true, networkPolicy: "sealed", expectedOutcome: "reject-positive" }, result: { accepted: true } }),
  ]));
  assert.equal(metrics.positiveRecall, 0.5);
  assert.equal(metrics.controlPassRate, 1);
});

test("ui evaluations: finished lifecycle does not imply a green verdict", () => {
  const failedScore = group([item({ result: { accepted: false }, outcome: "no_findings" })]);
  assert.equal(groupStateTone(failedScore), "neutral");
  assert.equal(workItemStateLabel(failedScore.items[0]), "Scored failure");
  assert.equal(workItemTone(failedScore.items[0]), "danger");

  const unscored = group([item({ evidenceContract: { kind: "confirmation-command", requiresDifferential: false, requiresRefutation: true, networkPolicy: "sealed" }, result: { accepted: null } })]);
  assert.equal(groupStateTone(unscored), "neutral");
});

test("ui evaluations: controls follow the durable lifecycle gates", () => {
  const draft = group([item({ state: "queued", outcome: null, result: null })], "draft");
  assert.equal(canStartRunGroup(draft), true);
  assert.equal(canAddWorkItem(draft), true);
  assert.equal(canCancelRunGroup(draft), true);
  assert.equal(canPauseRunGroup(draft), false);

  const running = group(draft.items, "running");
  assert.equal(canPauseRunGroup(running), true);
  assert.equal(canAddWorkItem(running), false);

  const blocked = item({ state: "failed", outcome: "blocked", result: { accepted: false } });
  assert.equal(canRetryWorkItem(group([blocked], "paused"), blocked), true);
  assert.equal(canRetryWorkItem(group([blocked], "cancelled"), blocked), false);
});

test("ui evaluations: modal footer buttons submit their associated native forms", () => {
  assert.match(evaluationViewSource, /type="submit" form="new-evaluation-form"/);
  assert.match(evaluationViewSource, /type="submit" form="add-work-item-form"/);
  assert.doesNotMatch(evaluationViewSource, /dispatchEvent\(new Event\("submit"/);
  assert.match(harnessViewSource, /type="submit" form="new-harness-experiment-form"/);
  assert.match(harnessViewSource, /type="submit" form="refine-harness-proposal-form"/);
  assert.doesNotMatch(harnessViewSource, /dispatchEvent\(new Event\("submit"/);
});

test("ui evaluations: harness decisions remain distinct from experiment lifecycle", () => {
  const base = { state: "decided", decision: null };
  assert.equal(harnessExperimentLabel({ ...base, decision: "promote" }), "Promote");
  assert.equal(harnessExperimentTone({ ...base, decision: "promote" }), "success");
  assert.equal(harnessExperimentLabel({ ...base, decision: "reject" }), "Rejected");
  assert.equal(harnessExperimentTone({ ...base, decision: "reject" }), "danger");
  assert.equal(harnessExperimentLabel({ state: "proposal-ready", decision: null }), "Proposal ready");
  assert.equal(harnessExperimentTone({ state: "evaluating", decision: null }), "active");
});

test("ui evaluations: harness workspace keeps the promotion boundary visible", () => {
  assert.match(harnessViewSource, /Promotion stays external/);
  assert.match(harnessViewSource, /Evaluator, benchmark answers, material policy, sandbox, confirmation\/refutation, tests, promotion, merge, and deploy/);
  assert.match(harnessViewSource, /Baseline ·/);
  assert.match(harnessViewSource, /Candidate ·/);
});

test("ui evaluations: clipboard denial falls back to the legacy copy path", () => {
  assert.match(evaluationViewSource, /await navigator\.clipboard\.writeText\(value\)/);
  assert.match(evaluationViewSource, /catch \{\s*\/\/ Restricted desktop shells/);
  assert.match(evaluationViewSource, /document\.execCommand\("copy"\)/);
  assert.match(evaluationViewSource, /\.catch\(\(copyError\) => onToast\("error", errorMessage\(copyError\)\)\)/);
});
