import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../dist/ingest/source.js";
import { materialFingerprint, phaseInputFingerprint } from "../dist/util/material-fingerprint.js";
import { preparedWorkspaceMaterialFingerprint, reconcileLegacyPreparedMaterialFingerprints } from "../dist/util/prepared-material-fingerprint.js";

test("material fingerprints are traversal-order independent but content and namespace sensitive", () => {
  const sourceA = { path: "src/a.ts", kind: "source", content: "export const a = 1;" };
  const sourceB = { path: "src/b.ts", kind: "source", content: "export const b = 2;" };
  const first = materialFingerprint([
    { label: "source", docs: [sourceB, sourceA] },
    { label: "corpus", docs: [] },
  ]);
  const reordered = materialFingerprint([
    { label: "corpus", docs: [] },
    { label: "source", docs: [sourceA, sourceB] },
  ]);
  const changed = materialFingerprint([
    { label: "source", docs: [sourceA, { ...sourceB, content: "export const b = 3;" }] },
    { label: "corpus", docs: [] },
  ]);
  const relabeled = materialFingerprint([{ label: "corpus", docs: [sourceA, sourceB] }]);

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.notEqual(first, relabeled);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
});

test("phase input fingerprints normalize object key order while preserving values", () => {
  const first = phaseInputFingerprint({ phase: "verify", finding: { id: 7, status: "suspected" }, attempts: [1, 2] });
  const reordered = phaseInputFingerprint({ attempts: [1, 2], finding: { status: "suspected", id: 7 }, phase: "verify" });
  const changed = phaseInputFingerprint({ phase: "verify", finding: { id: 7, status: "confirmed-executable" }, attempts: [1, 2] });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("prepare and audit fingerprint the same staged workspace identically", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "flounder-material-workspace-"));
  try {
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "Target.sol"), "contract Target {}\n");

    const prepareFingerprint = await preparedWorkspaceMaterialFingerprint(workspace, []);
    const auditSource = await loadSource([workspace], { publicRoot: workspace });
    const auditBuild = await loadSource([workspace], { publicRoot: workspace });
    const auditFingerprint = materialFingerprint([
      { label: "source", docs: auditSource },
      { label: "build", docs: auditBuild },
      { label: "corpus", docs: [] },
    ]);

    assert.equal(prepareFingerprint, auditFingerprint);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("prepared workspace fingerprints are backfilled only after an exact canonical result", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "flounder-legacy-prepare-run-"));
  const workspace = path.join(runDir, "prepare", "workspace");
  try {
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "Target.sol"), "contract Target {}\n");
    const legacySource = await loadSource([workspace]);
    const legacyFingerprint = materialFingerprint([
      { label: "source", docs: legacySource },
      { label: "build", docs: legacySource },
      { label: "corpus", docs: [] },
    ]);
    const canonicalFingerprint = await preparedWorkspaceMaterialFingerprint(workspace, []);
    assert.notEqual(legacyFingerprint, canonicalFingerprint);

    const runs = [
      { id: 1, project_id: 7, kind: "prepare", status: "done", run_dir: runDir, material_fingerprint: legacyFingerprint, started_at: "2026-01-01T00:00:00.000Z" },
      { id: 2, project_id: 7, kind: "run", status: "done", run_dir: path.join(runDir, "audit"), material_fingerprint: canonicalFingerprint, started_at: "2026-01-01T00:01:00.000Z" },
      { id: 3, project_id: 8, kind: "prepare", status: "done", run_dir: runDir, material_fingerprint: "sha256:included-external-corpus", started_at: "2026-01-01T00:00:00.000Z" },
      { id: 4, project_id: 8, kind: "run", status: "done", run_dir: path.join(runDir, "other"), material_fingerprint: canonicalFingerprint, started_at: "2026-01-01T00:01:00.000Z" },
      { id: 5, project_id: 9, kind: "prepare", status: "done", run_dir: runDir, material_fingerprint: "sha256:unverified", started_at: "2026-01-01T00:00:00.000Z" },
      { id: 6, project_id: 9, kind: "run", status: "done", run_dir: path.join(runDir, "unrelated"), material_fingerprint: "sha256:different", started_at: "2026-01-01T00:01:00.000Z" },
    ];
    const replacements = [];
    const changed = await reconcileLegacyPreparedMaterialFingerprints(runs, (runId, expected, replacement) => {
      replacements.push({ runId, expected, replacement });
      return true;
    });

    assert.equal(changed, 2);
    assert.deepEqual(replacements, [
      { runId: 1, expected: legacyFingerprint, replacement: canonicalFingerprint },
      { runId: 3, expected: "sha256:included-external-corpus", replacement: canonicalFingerprint },
    ]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
