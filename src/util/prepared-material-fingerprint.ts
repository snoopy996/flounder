import path from "node:path";
import { existsSync } from "node:fs";
import { loadCorpus, loadSource } from "../ingest/source.js";
import { materialFingerprint } from "./material-fingerprint.js";

export interface PreparedMaterialRunRow extends Record<string, unknown> {
  id?: unknown;
  project_id?: unknown;
  kind?: unknown;
  status?: unknown;
  run_dir?: unknown;
  material_fingerprint?: unknown;
  started_at?: unknown;
}

export async function preparedWorkspaceMaterialFingerprint(workspaceDir: string, corpusPaths: string[]): Promise<string> {
  const preparedSource = await loadSource([workspaceDir], { publicRoot: workspaceDir });
  const preparedCorpus = corpusPaths.length > 0 ? await loadCorpus(corpusPaths) : [];
  return workspaceFingerprint(preparedSource, preparedCorpus);
}

export async function reconcileLegacyPreparedMaterialFingerprints(
  runs: PreparedMaterialRunRow[],
  replace: (runId: number, expected: string, replacement: string) => boolean,
): Promise<number> {
  let changed = 0;
  for (const prepare of runs) {
    const prepareId = Number(prepare.id);
    const projectId = Number(prepare.project_id);
    const runDir = stringValue(prepare.run_dir);
    const storedFingerprint = stringValue(prepare.material_fingerprint);
    const prepareStartedAt = stringValue(prepare.started_at);
    if (!Number.isFinite(prepareId) || !Number.isFinite(projectId) || prepare.kind !== "prepare" || prepare.status !== "done" || !runDir || !storedFingerprint) continue;
    const workspaceDir = path.join(path.resolve(runDir), "prepare", "workspace");
    if (!existsSync(workspaceDir)) continue;
    const canonical = await preparedWorkspaceMaterialFingerprint(workspaceDir, []);
    if (canonical === storedFingerprint) continue;
    const hasCanonicalLaterResult = runs.some((run) => Number(run.project_id) === projectId
      && run.kind !== "prepare"
      && stringValue(run.material_fingerprint) === canonical
      && Boolean(stringValue(run.started_at) && prepareStartedAt && stringValue(run.started_at) >= prepareStartedAt));
    if (!hasCanonicalLaterResult) continue;
    if (replace(prepareId, storedFingerprint, canonical)) changed += 1;
  }
  return changed;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function workspaceFingerprint(source: Awaited<ReturnType<typeof loadSource>>, corpus: Awaited<ReturnType<typeof loadCorpus>>): string {
  return materialFingerprint([
    { label: "source", docs: source },
    { label: "build", docs: source },
    { label: "corpus", docs: corpus },
  ]);
}
