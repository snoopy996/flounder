import type { LaunchSpec } from "../server/run-manager.js";
import {
  capabilitySurfaceScopeNote,
  normalizeEvidenceContract,
  normalizeMaterialPolicy,
  normalizeTargetBundle,
  type EvidenceContract,
  type WorkItemKind,
  type WorkItemOutcome,
} from "./contracts.js";

export interface WorkItemSettlement {
  state: "finished" | "failed" | "cancelled";
  outcome: WorkItemOutcome;
  result: Record<string, unknown>;
  error?: string;
}

export function buildWorkItemLaunchSpec(item: Record<string, unknown>, group: Record<string, unknown>): LaunchSpec {
  const kind = String(item.kind) as WorkItemKind;
  if (kind === "custom") throw new Error("custom work items require an explicit product adapter and cannot execute through the generic scheduler");
  const targetBundle = normalizeTargetBundle(parseJsonObject(item.target_bundle_json), `work item ${String(item.item_key)} target bundle`);
  const materialPolicy = normalizeMaterialPolicy(parseJsonObject(item.material_policy_json), targetBundle);
  if (materialPolicy.materials.some((material) => material.policyDecision === "warning")) {
    throw new Error("material policy warnings require an explicit operator inclusion or exclusion before execution");
  }
  const evidenceContract = normalizeEvidenceContract(parseJsonObject(item.evidence_contract_json), kind);
  if (evidenceContract.kind === "manual-review") throw new Error("manual-review work items are human gates and do not launch model work");
  if (evidenceContract.networkPolicy === "open-world-read") {
    throw new Error("generic run-group work items are sealed; open-world evidence requires the existing confirm workflow");
  }
  if (kind === "verify-claim" && targetBundle.claim === undefined) throw new Error("verify-claim work items need targetBundle.claim");

  const groupConfig = parseJsonObject(group.config_json);
  const scopeNoteParts = [targetBundle.scopeNote];
  if (targetBundle.capabilitySurface) scopeNoteParts.push(capabilitySurfaceScopeNote(targetBundle.capabilitySurface));
  const scopeNote = scopeNoteParts.filter((value): value is string => Boolean(value && value.trim())).join("\n\n") || undefined;
  const provider = targetBundle.provider ?? stringValue(groupConfig.provider);
  const model = targetBundle.model ?? stringValue(groupConfig.model);
  const thinking = targetBundle.thinking ?? stringValue(groupConfig.thinking);

  const spec: LaunchSpec = {
    verb: kind === "verify-claim" ? "audit" : "run",
    target: targetBundle.target,
    sourcePaths: targetBundle.sourcePaths,
    corpusPaths: includedCorpusPaths(targetBundle.corpusPaths, materialPolicy),
    ...(targetBundle.buildRoot ? { buildRoot: targetBundle.buildRoot } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(scopeNote ? { scopeNote } : {}),
    ...(targetBundle.mockLlm ? { mockLlm: true } : {}),
    ...(targetBundle.maxScopes !== undefined ? { maxScopes: targetBundle.maxScopes } : {}),
    ...(targetBundle.mapSteps !== undefined ? { mapSteps: targetBundle.mapSteps } : {}),
    ...(targetBundle.digSteps !== undefined ? { digSteps: targetBundle.digSteps } : {}),
    ...(targetBundle.maxSteps !== undefined ? { maxSteps: targetBundle.maxSteps } : {}),
    ...(targetBundle.digSamples !== undefined ? { digSamples: targetBundle.digSamples } : {}),
    ...(targetBundle.digConcurrency !== undefined ? { digConcurrency: targetBundle.digConcurrency } : {}),
    ...(targetBundle.sandboxBackend ? { sandboxBackend: targetBundle.sandboxBackend } : {}),
    ...(targetBundle.sandboxImage ? { sandboxImage: targetBundle.sandboxImage } : {}),
    ...(kind === "verify-claim" ? { verifyFindings: targetBundle.claim } : {}),
  };
  return spec;
}

export function settleWorkItem(input: {
  item: Record<string, unknown>;
  jobStatus: "done" | "error" | "canceled";
  jobError?: string;
  run?: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
}): WorkItemSettlement {
  if (input.jobStatus === "canceled") {
    return { state: "cancelled", outcome: "blocked", result: { accepted: false, reason: "operator-cancelled" }, ...(input.jobError ? { error: input.jobError } : {}) };
  }
  if (input.jobStatus === "error") {
    const error = input.jobError ?? "daemon job failed";
    return { state: "failed", outcome: "blocked", result: { accepted: false, reason: "execution-blocked", error }, error };
  }
  if (!input.run) {
    return { state: "failed", outcome: "blocked", result: { accepted: false, reason: "job-finished-without-run" }, error: "job finished without a run record" };
  }
  const runStatus = stringValue(input.run.status);
  if (runStatus !== "done") {
    const error = `run status is ${runStatus ?? "missing"}`;
    return { state: "failed", outcome: "blocked", result: { accepted: false, reason: "run-not-complete", runId: input.run.id, runStatus: runStatus ?? null }, error };
  }
  const health = stringValue(input.run.health_status);
  if (health === "infra-failed" || health === "needs-resource") {
    const error = `run health is ${health}`;
    return { state: "failed", outcome: "blocked", result: { accepted: false, reason: health, runId: input.run.id }, error };
  }

  const kind = String(input.item.kind) as WorkItemKind;
  const evidence = normalizeEvidenceContract(parseJsonObject(input.item.evidence_contract_json), kind);
  if (evidence.expectedOutcome !== undefined && health !== "healthy") {
    const error = `scored work item has no healthy run verdict (${health ?? "missing"})`;
    return { state: "failed", outcome: "blocked", result: { accepted: false, reason: "run-health-unscored", runId: input.run.id, runHealth: health ?? null }, error };
  }
  const confirmed = input.findings.filter((finding) => isConfirmedStatus(finding.status));
  const differential = input.findings.filter((finding) => finding.status === "confirmed-differential");
  const refuted = input.findings.filter((finding) => finding.status === "refuted" || String(finding.title ?? "").startsWith("REFUTED:"));
  const refutationStage = nestedRecord(parseJsonObject(input.run.stages_json), "refutation");
  const refutationCandidates = numberValue(refutationStage.candidates);
  const refutationVerdicts = numberValue(refutationStage.verdicts);
  const refutationComplete = confirmed.length === 0 || !evidence.requiresRefutation || (
    refutationCandidates >= confirmed.length && refutationVerdicts >= refutationCandidates && numberValue(refutationStage.errors) === 0
  );
  if (!refutationComplete) {
    const error = "required independent refutation evidence is missing or incomplete";
    return {
      state: "failed",
      outcome: "blocked",
      result: {
        accepted: false,
        reason: "refutation-incomplete",
        runId: input.run.id,
        confirmedFindings: confirmed.length,
        refutationCandidates,
        refutationVerdicts,
        refutationErrors: numberValue(refutationStage.errors),
      },
      error,
    };
  }
  const positive = evidence.requiresDifferential ? differential.length > 0 : confirmed.length > 0;
  const scorePassed = evidence.expectedOutcome === "detect-positive"
    ? positive
    : evidence.expectedOutcome === "reject-positive"
      ? confirmed.length === 0
      : true;
  const result = {
    accepted: evidence.expectedOutcome === undefined ? null : scorePassed,
    gateSatisfied: true,
    expectedOutcome: evidence.expectedOutcome ?? null,
    evidenceGate: evidence.kind,
    networkPolicy: evidence.networkPolicy,
    requiresDifferential: evidence.requiresDifferential,
    requiresRefutation: evidence.requiresRefutation,
    confirmedFindings: confirmed.length,
    differentialFindings: differential.length,
    refutedFindings: refuted.length,
    runId: input.run.id,
    runHealth: health ?? null,
  };

  if (!scorePassed) {
    return { state: "finished", outcome: evidence.expectedOutcome === "reject-positive" ? "findings_reported" : "no_findings", result };
  }
  if (kind === "verify-claim") {
    if (positive) return { state: "finished", outcome: "confirmed", result };
    if (refuted.length > 0) return { state: "finished", outcome: "refuted", result };
    return { state: "failed", outcome: "blocked", result: { ...result, gateSatisfied: false, reason: "claim-unsettled" }, error: "claim was neither confirmed nor refuted" };
  }
  return { state: "finished", outcome: confirmed.length > 0 ? "findings_reported" : "no_findings", result };
}

export function renderRunGroupReport(group: Record<string, unknown>, items: Array<Record<string, unknown>>): { summary: Record<string, unknown>; markdown: string } {
  const byState = counts(items, "state");
  const byOutcome = counts(items, "outcome");
  const scored = items
    .filter((item) => item.state === "finished" && item.outcome !== "blocked" && item.outcome !== "invalid")
    .map((item) => parseJsonObject(item.result_json))
    .filter((result) => typeof result.accepted === "boolean");
  const passed = scored.filter((result) => result.accepted === true).length;
  const summary = {
    totalItems: items.length,
    byState,
    byOutcome,
    scoredItems: scored.length,
    passedItems: passed,
    passRate: scored.length === 0 ? null : passed / scored.length,
  };
  const lines = [
    `# Run Group: ${String(group.name)}`,
    "",
    `- State: ${String(group.state)}`,
    `- Kind: ${String(group.kind)}`,
    `- Items: ${items.length}`,
    `- Scored: ${scored.length}`,
    `- Passed: ${passed}`,
    `- Pass rate: ${scored.length === 0 ? "n/a" : `${Math.round((passed / scored.length) * 10_000) / 100}%`}`,
    "",
    "## Work Items",
    "",
    "| Key | Kind | State | Outcome | Accepted |",
    "| --- | --- | --- | --- | --- |",
    ...items.map((item) => {
      const result = parseJsonObject(item.result_json);
      const scoreEligible = item.state === "finished" && item.outcome !== "blocked" && item.outcome !== "invalid";
      const accepted = scoreEligible && typeof result.accepted === "boolean" ? String(result.accepted) : "-";
      return `| ${escapeCell(String(item.item_key))} | ${escapeCell(String(item.kind))} | ${escapeCell(String(item.state))} | ${escapeCell(String(item.outcome ?? "-"))} | ${accepted} |`;
    }),
    "",
  ];
  return { summary, markdown: lines.join("\n") };
}

function includedCorpusPaths(corpusPaths: string[], policy: ReturnType<typeof normalizeMaterialPolicy>): string[] {
  const included = new Set(policy.materials.filter((material) => material.policyDecision === "included").map((material) => material.path));
  return corpusPaths.filter((materialPath) => included.has(materialPath));
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isConfirmedStatus(value: unknown): boolean {
  return value === "confirmed-executable" || value === "confirmed-differential" || value === "confirmed-source";
}

function counts(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? "none");
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
