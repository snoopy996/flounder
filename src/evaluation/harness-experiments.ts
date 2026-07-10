import { createHash } from "node:crypto";
import path from "node:path";

export const HARNESS_EXPERIMENT_STATES = ["needs-evidence", "proposal-ready", "evaluating", "decided"] as const;
export type HarnessExperimentState = (typeof HARNESS_EXPERIMENT_STATES)[number];

export const HARNESS_DECISIONS = ["promote", "reject", "needs-more-samples"] as const;
export type HarnessDecision = (typeof HARNESS_DECISIONS)[number];

export const HARNESS_FAILURE_KINDS = [
  "positive-miss",
  "control-false-positive",
  "execution-blocked",
  "policy-invalid",
] as const;
export type HarnessFailureKind = (typeof HARNESS_FAILURE_KINDS)[number];

export interface HarnessPromotionPolicy {
  minimumSamplesPerClass: number;
  minimumImprovedCases: number;
  requireAllControlsPass: boolean;
  maxBlockedRate: number;
  maxDurationRatio: number;
  maxAttemptRatio: number;
}

export interface HarnessExperimentInput {
  name: string;
  baselineRunGroupUuid: string;
  candidateRunGroupUuid?: string;
  editableFiles: string[];
  promotionPolicy: HarnessPromotionPolicy;
}

export interface HarnessFailurePattern {
  id: string;
  kind: HarnessFailureKind;
  mechanism: string;
  verifierCause: string;
  causalStatus: string;
  occurrences: number;
  workItemKeys: string[];
}

export interface PreservedBehavior {
  workItemKey: string;
  expectedOutcome: "detect-positive" | "reject-positive";
  evidenceGate: string;
}

export interface HarnessProposalChange {
  path: string;
  summary: string;
}

export interface HarnessCandidateProposal {
  title: string;
  hypothesis: string;
  failurePatternIds: string[];
  editableFiles: string[];
  changes: HarnessProposalChange[];
  preserve: string[];
}

export interface HarnessEvidenceItem {
  itemKey: string;
  state: string;
  outcome: string | null;
  expectedOutcome: "detect-positive" | "reject-positive" | null;
  evidenceGate: string;
  contractFingerprint: string | null;
  accepted: boolean | null;
  reason: string | null;
  attempts: number;
  durationSeconds: number | null;
}

export interface HarnessGroupSnapshot {
  uuid: string;
  name: string;
  state: string;
  items: HarnessEvidenceItem[];
}

export interface HarnessScoreMetrics {
  total: number;
  scored: number;
  passed: number;
  positives: number;
  positivesPassed: number;
  controls: number;
  controlsPassed: number;
  blocked: number;
  invalid: number;
  attempts: number;
  durationSeconds: number | null;
  passRate: number | null;
  positiveRecall: number | null;
  controlPassRate: number | null;
  blockedRate: number;
}

export interface HarnessExperimentScorecard {
  decision: HarnessDecision;
  reasons: string[];
  baseline: HarnessScoreMetrics;
  candidate: HarnessScoreMetrics;
  improvedItemKeys: string[];
  regressedItemKeys: string[];
  durationRatio: number | null;
  attemptRatio: number | null;
  evaluatedAt: string;
}

const DEFAULT_PROMOTION_POLICY: HarnessPromotionPolicy = {
  minimumSamplesPerClass: 2,
  minimumImprovedCases: 1,
  requireAllControlsPass: true,
  maxBlockedRate: 0,
  maxDurationRatio: 1.25,
  maxAttemptRatio: 1.25,
};

const EDITABLE_HARNESS_FILES = new Set([
  "src/agent/audit.ts",
  "src/agent/discovery-artifacts.ts",
  "src/agent/loop.ts",
  "src/agent/memory.ts",
  "src/agent/prepare.ts",
  "src/agent/prompts.ts",
]);

const EDITABLE_HARNESS_PREFIXES = ["prompts/", "skills/"] as const;

export function normalizeHarnessExperimentInput(input: unknown): HarnessExperimentInput {
  const record = requireRecord(input, "harness experiment");
  const editableFiles = stringList(record.editableFiles ?? record.editable_files, "editableFiles").map(normalizeEditableFile);
  if (editableFiles.length === 0) throw new Error("harness experiment needs at least one editable file");
  if (editableFiles.length > 20) throw new Error("harness experiment supports at most 20 editable files");
  const policyRecord = optionalRecord(record.promotionPolicy ?? record.promotion_policy);
  return {
    name: requiredString(record.name, "name"),
    baselineRunGroupUuid: requiredString(record.baselineRunGroupUuid ?? record.baseline_run_group_uuid, "baselineRunGroupUuid"),
    ...optionalStringField("candidateRunGroupUuid", record.candidateRunGroupUuid ?? record.candidate_run_group_uuid),
    editableFiles: [...new Set(editableFiles)],
    promotionPolicy: {
      minimumSamplesPerClass: boundedInteger(policyRecord.minimumSamplesPerClass ?? policyRecord.minimum_samples_per_class, DEFAULT_PROMOTION_POLICY.minimumSamplesPerClass, 1, 100),
      minimumImprovedCases: boundedInteger(policyRecord.minimumImprovedCases ?? policyRecord.minimum_improved_cases, DEFAULT_PROMOTION_POLICY.minimumImprovedCases, 1, 100),
      requireAllControlsPass: booleanValue(policyRecord.requireAllControlsPass ?? policyRecord.require_all_controls_pass, DEFAULT_PROMOTION_POLICY.requireAllControlsPass),
      maxBlockedRate: boundedRatio(policyRecord.maxBlockedRate ?? policyRecord.max_blocked_rate, DEFAULT_PROMOTION_POLICY.maxBlockedRate, 0, 1),
      maxDurationRatio: boundedRatio(policyRecord.maxDurationRatio ?? policyRecord.max_duration_ratio, DEFAULT_PROMOTION_POLICY.maxDurationRatio, 1, 10),
      maxAttemptRatio: boundedRatio(policyRecord.maxAttemptRatio ?? policyRecord.max_attempt_ratio, DEFAULT_PROMOTION_POLICY.maxAttemptRatio, 1, 10),
    },
  };
}

export function normalizeHarnessProposal(input: unknown, editableFiles: string[], failurePatterns: HarnessFailurePattern[]): HarnessCandidateProposal {
  const record = requireRecord(input, "harness candidate proposal");
  const allowed = new Set(editableFiles.map(normalizeEditableFile));
  const knownPatterns = new Set(failurePatterns.map((pattern) => pattern.id));
  const proposalFiles = stringList(record.editableFiles ?? record.editable_files, "proposal editableFiles").map(normalizeEditableFile);
  if (proposalFiles.length === 0) throw new Error("candidate proposal needs at least one bounded editable file");
  if (proposalFiles.some((file) => !allowed.has(file))) throw new Error("candidate proposal may only reference the experiment's bounded editable files");
  const proposalAllowed = new Set(proposalFiles);
  const patternIds = stringList(record.failurePatternIds ?? record.failure_pattern_ids, "proposal failurePatternIds");
  if (patternIds.length === 0) throw new Error("candidate proposal must reference at least one verifier-grounded failure pattern");
  if (patternIds.some((id) => !knownPatterns.has(id))) throw new Error("candidate proposal references an unknown verifier-grounded failure pattern");
  const changedPaths = new Set<string>();
  const changes = arrayValue(record.changes, "proposal changes").map((value, index) => {
    const change = requireRecord(value, `proposal change ${index + 1}`);
    const proposalPath = normalizeEditableFile(requiredString(change.path, `proposal change ${index + 1} path`));
    if (!allowed.has(proposalPath)) throw new Error(`candidate proposal cannot edit protected or undeclared file: ${proposalPath}`);
    if (!proposalAllowed.has(proposalPath)) throw new Error(`candidate proposal change is outside its declared editable files: ${proposalPath}`);
    if (changedPaths.has(proposalPath)) throw new Error(`candidate proposal contains duplicate changes for: ${proposalPath}`);
    changedPaths.add(proposalPath);
    return { path: proposalPath, summary: requiredString(change.summary, `proposal change ${index + 1} summary`) };
  });
  if (changes.length === 0) throw new Error("candidate proposal needs at least one bounded change");
  if (changedPaths.size !== proposalAllowed.size) throw new Error("candidate proposal needs exactly one change for every declared editable file");
  return {
    title: requiredString(record.title, "proposal title"),
    hypothesis: requiredString(record.hypothesis, "proposal hypothesis"),
    failurePatternIds: [...new Set(patternIds)],
    editableFiles: [...new Set(proposalFiles)],
    changes,
    preserve: stringList(record.preserve, "proposal preserve"),
  };
}

export function mineHarnessWeaknesses(items: HarnessEvidenceItem[]): HarnessFailurePattern[] {
  const grouped = new Map<string, HarnessFailurePattern>();
  for (const item of items) {
    const kind = failureKind(item);
    if (!kind) continue;
    const mechanism = failureMechanism(kind, item.reason);
    const verifierCause = normalizeFailureCause(item.reason ?? defaultFailureCause(kind));
    const causalStatus = `${item.state}/${item.outcome ?? "no-outcome"}`;
    const fingerprint = createHash("sha256").update(`${kind}\n${mechanism}\n${verifierCause}`).digest("hex").slice(0, 16);
    const id = `weakness-${fingerprint}`;
    const current = grouped.get(id);
    if (current) {
      current.occurrences += 1;
      if (!current.workItemKeys.includes(item.itemKey)) current.workItemKeys.push(item.itemKey);
      continue;
    }
    grouped.set(id, { id, kind, mechanism, verifierCause, causalStatus, occurrences: 1, workItemKeys: [item.itemKey] });
  }
  return [...grouped.values()].sort((a, b) => b.occurrences - a.occurrences || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function minePreservedBehaviors(items: HarnessEvidenceItem[]): PreservedBehavior[] {
  return items
    .filter((item) => item.accepted === true && item.expectedOutcome !== null)
    .map((item) => ({ workItemKey: item.itemKey, expectedOutcome: item.expectedOutcome!, evidenceGate: item.evidenceGate }))
    .sort((a, b) => a.workItemKey.localeCompare(b.workItemKey));
}

export function buildHarnessCandidateProposal(
  patterns: HarnessFailurePattern[],
  preserved: PreservedBehavior[],
  editableFiles: string[],
): HarnessCandidateProposal | null {
  if (patterns.length === 0) return null;
  const selected = patterns.slice(0, 5);
  const mechanismSummary = [...new Set(selected.map((pattern) => pattern.mechanism))].join(", ");
  const preserve = preserved.slice(0, 20).map((behavior) => `${behavior.workItemKey}: keep ${behavior.expectedOutcome} under ${behavior.evidenceGate}`);
  return {
    title: `Reduce ${selected[0]!.kind.replaceAll("-", " ")} failures without weakening evidence gates`,
    hypothesis: `A narrow harness change addressing ${mechanismSummary} can improve the failed baseline cases while preserving every passing positive and control case.`,
    failurePatternIds: selected.map((pattern) => pattern.id),
    editableFiles,
    changes: editableFiles.map((file) => ({
      path: file,
      summary: `Make only the smallest change in ${file} that addresses the selected verifier-grounded patterns; do not add target-specific answers, taxonomy, or alternate confirmation logic.`,
    })),
    preserve,
  };
}

export function scoreHarnessExperiment(
  baseline: HarnessGroupSnapshot,
  candidate: HarnessGroupSnapshot,
  policy: HarnessPromotionPolicy,
): HarnessExperimentScorecard {
  const baselineMetrics = scoreMetrics(baseline.items);
  const candidateMetrics = scoreMetrics(candidate.items);
  const reasons: string[] = [];
  const baselineByKey = uniqueItemsByKey(baseline.items, "baseline");
  const candidateByKey = uniqueItemsByKey(candidate.items, "candidate");
  const baselineKeys = [...baselineByKey.keys()].sort();
  const candidateKeys = [...candidateByKey.keys()].sort();
  const comparableKeys = baselineKeys.length === candidateKeys.length && baselineKeys.every((key, index) => key === candidateKeys[index]);
  const improvedItemKeys: string[] = [];
  const regressedItemKeys: string[] = [];

  if (comparableKeys) {
    for (const key of baselineKeys) {
      const before = baselineByKey.get(key)!;
      const after = candidateByKey.get(key)!;
      if (before.expectedOutcome !== after.expectedOutcome) reasons.push(`Evidence expectation changed for ${key}; candidate and baseline are not comparable.`);
      if (before.contractFingerprint !== after.contractFingerprint) reasons.push(`Target, material, or evidence contract changed for ${key}; candidate and baseline are not comparable.`);
      if (before.accepted === false && after.accepted === true) improvedItemKeys.push(key);
      if (before.accepted === true && after.accepted === false) regressedItemKeys.push(key);
    }
  } else {
    reasons.push("Baseline and candidate must contain the same stable work-item keys.");
  }

  const durationRatio = ratio(candidateMetrics.durationSeconds, baselineMetrics.durationSeconds);
  const attemptRatio = ratio(candidateMetrics.attempts, baselineMetrics.attempts);
  let decision: HarnessDecision;
  if (!comparableKeys || reasons.some((reason) => reason.includes("not comparable"))) {
    decision = "reject";
  } else if (baseline.state !== "finished" || candidate.state !== "finished") {
    decision = "needs-more-samples";
    reasons.push("Both run groups must finish before the promotion gate can decide.");
  } else if (baselineMetrics.blocked > 0 || candidateMetrics.blocked > 0 || baselineMetrics.invalid > 0 || candidateMetrics.invalid > 0) {
    decision = "needs-more-samples";
    reasons.push("Blocked or invalid work items must be repaired and rerun; infrastructure failure is not evaluation evidence.");
  } else if (
    baselineMetrics.positives < policy.minimumSamplesPerClass
    || candidateMetrics.positives < policy.minimumSamplesPerClass
    || baselineMetrics.controls < policy.minimumSamplesPerClass
    || candidateMetrics.controls < policy.minimumSamplesPerClass
  ) {
    decision = "needs-more-samples";
    reasons.push(`Each variant needs at least ${policy.minimumSamplesPerClass} scored positive and control samples.`);
  } else if (regressedItemKeys.length > 0) {
    decision = "reject";
    reasons.push(`${regressedItemKeys.length} previously passing case${regressedItemKeys.length === 1 ? "" : "s"} regressed.`);
  } else if (policy.requireAllControlsPass && candidateMetrics.controlsPassed !== candidateMetrics.controls) {
    decision = "reject";
    reasons.push("Candidate controls must all pass; confirmed findings on a safe control are a regression.");
  } else if (candidateMetrics.blockedRate > policy.maxBlockedRate) {
    decision = "reject";
    reasons.push(`Candidate blocked rate ${formatRate(candidateMetrics.blockedRate)} exceeds the ${formatRate(policy.maxBlockedRate)} budget.`);
  } else if (durationRatio !== null && durationRatio > policy.maxDurationRatio) {
    decision = "reject";
    reasons.push(`Candidate duration ratio ${durationRatio.toFixed(2)} exceeds the ${policy.maxDurationRatio.toFixed(2)} budget.`);
  } else if (attemptRatio !== null && attemptRatio > policy.maxAttemptRatio) {
    decision = "reject";
    reasons.push(`Candidate attempt ratio ${attemptRatio.toFixed(2)} exceeds the ${policy.maxAttemptRatio.toFixed(2)} budget.`);
  } else if (improvedItemKeys.length < policy.minimumImprovedCases) {
    decision = "reject";
    reasons.push(`Candidate improved ${improvedItemKeys.length} cases; policy requires at least ${policy.minimumImprovedCases}.`);
  } else {
    decision = "promote";
    reasons.push(`Candidate improved ${improvedItemKeys.length} cases with no paired regressions and kept every control passing.`);
  }

  return {
    decision,
    reasons,
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    improvedItemKeys,
    regressedItemKeys,
    durationRatio,
    attemptRatio,
    evaluatedAt: new Date().toISOString(),
  };
}

export function renderHarnessCandidateBrief(input: {
  experimentName: string;
  baselineGroup: HarnessGroupSnapshot;
  proposal: HarnessCandidateProposal;
  patterns: HarnessFailurePattern[];
  policy: HarnessPromotionPolicy;
}): string {
  const selected = new Set(input.proposal.failurePatternIds);
  const patterns = input.patterns.filter((pattern) => selected.has(pattern.id));
  return [
    `# Harness Candidate Brief: ${input.experimentName}`,
    "",
    `Baseline evaluation: ${input.baselineGroup.name} (${input.baselineGroup.uuid})`,
    "",
    "## Hypothesis",
    "",
    input.proposal.hypothesis,
    "",
    "## Verifier-grounded weaknesses",
    "",
    ...patterns.map((pattern) => `- ${pattern.id}: ${pattern.kind}; ${pattern.mechanism}; ${pattern.verifierCause} (${pattern.occurrences} occurrence${pattern.occurrences === 1 ? "" : "s"})`),
    "",
    "## Bounded editable surface",
    "",
    ...input.proposal.changes.map((change) => `- \`${change.path}\`: ${change.summary}`),
    "",
    "## Behaviors to preserve",
    "",
    ...(input.proposal.preserve.length ? input.proposal.preserve.map((value) => `- ${value}`) : ["- No passing baseline behavior was available; do not weaken any evidence or safety gate."]),
    "",
    "## Promotion gate",
    "",
    `- At least ${input.policy.minimumSamplesPerClass} positive and ${input.policy.minimumSamplesPerClass} control samples per variant.`,
    `- At least ${input.policy.minimumImprovedCases} improved paired case${input.policy.minimumImprovedCases === 1 ? "" : "s"}; zero paired regressions.`,
    `- Candidate blocked rate at most ${formatRate(input.policy.maxBlockedRate)}.`,
    `- Candidate duration and attempt ratios at most ${input.policy.maxDurationRatio.toFixed(2)} and ${input.policy.maxAttemptRatio.toFixed(2)}.`,
    "",
    "## Protected boundary",
    "",
    "Do not edit the evaluator, benchmark answers, material policy, sandbox or command safety, confirmation/refutation gates, promotion policy, release policy, or tests to make the candidate pass. Produce a normal reviewable branch or draft PR; never merge or deploy automatically.",
    "",
  ].join("\n");
}

export function harnessEvidenceItemFromRow(row: Record<string, unknown>): HarnessEvidenceItem {
  const evidence = jsonRecord(row.evidenceContract ?? row.evidence_contract_json);
  const target = jsonRecord(row.targetBundle ?? row.target_bundle_json);
  const material = jsonRecord(row.materialPolicy ?? row.material_policy_json);
  const result = jsonRecord(row.result ?? row.result_json);
  const expected = evidence.expectedOutcome ?? evidence.expected_outcome;
  const started = dateMillis(row.started_at);
  const ended = dateMillis(row.ended_at);
  return {
    itemKey: String(row.item_key ?? row.itemKey ?? ""),
    state: String(row.state ?? "unknown"),
    outcome: typeof row.outcome === "string" ? row.outcome : null,
    expectedOutcome: expected === "detect-positive" || expected === "reject-positive" ? expected : null,
    evidenceGate: typeof evidence.kind === "string" ? evidence.kind : "unknown",
    contractFingerprint: createHash("sha256").update(stableJson({ kind: row.kind, target, material, evidence })).digest("hex"),
    accepted: typeof result.accepted === "boolean" ? result.accepted : null,
    reason: firstString(result.reason, row.last_error, row.error),
    attempts: finiteInteger(row.attempts) ?? 0,
    durationSeconds: started !== null && ended !== null && ended >= started ? Math.round((ended - started) / 1000) : null,
  };
}

function scoreMetrics(items: HarnessEvidenceItem[]): HarnessScoreMetrics {
  const scored = items.filter((item) => item.accepted !== null);
  const positives = scored.filter((item) => item.expectedOutcome === "detect-positive");
  const controls = scored.filter((item) => item.expectedOutcome === "reject-positive");
  const durationValues = items.map((item) => item.durationSeconds).filter((value): value is number => value !== null);
  const blocked = items.filter((item) => item.outcome === "blocked" || item.state === "failed" || item.state === "cancelled").length;
  return {
    total: items.length,
    scored: scored.length,
    passed: scored.filter((item) => item.accepted === true).length,
    positives: positives.length,
    positivesPassed: positives.filter((item) => item.accepted === true).length,
    controls: controls.length,
    controlsPassed: controls.filter((item) => item.accepted === true).length,
    blocked,
    invalid: items.filter((item) => item.outcome === "invalid").length,
    attempts: items.reduce((sum, item) => sum + item.attempts, 0),
    durationSeconds: durationValues.length === items.length && items.length > 0 ? durationValues.reduce((sum, value) => sum + value, 0) : null,
    passRate: scored.length ? scored.filter((item) => item.accepted === true).length / scored.length : null,
    positiveRecall: positives.length ? positives.filter((item) => item.accepted === true).length / positives.length : null,
    controlPassRate: controls.length ? controls.filter((item) => item.accepted === true).length / controls.length : null,
    blockedRate: items.length ? blocked / items.length : 0,
  };
}

function failureKind(item: HarnessEvidenceItem): HarnessFailureKind | null {
  if (item.outcome === "invalid") return "policy-invalid";
  if (item.outcome === "blocked" || item.state === "failed" || item.state === "cancelled") return "execution-blocked";
  if (item.accepted === false && item.expectedOutcome === "detect-positive") return "positive-miss";
  if (item.accepted === false && item.expectedOutcome === "reject-positive") return "control-false-positive";
  return null;
}

function failureMechanism(kind: HarnessFailureKind, cause: string | null): string {
  const normalized = (cause ?? "").toLowerCase();
  if (normalized.includes("refutation")) return "refutation completeness";
  if (normalized.includes("health")) return "run health";
  if (normalized.includes("build") || normalized.includes("prepare") || normalized.includes("compile")) return "target preparation";
  if (normalized.includes("policy") || normalized.includes("sandbox") || normalized.includes("command")) return "policy boundary";
  if (kind === "positive-miss") return "recall";
  if (kind === "control-false-positive") return "false-positive control";
  if (kind === "policy-invalid") return "policy boundary";
  return "execution infrastructure";
}

function defaultFailureCause(kind: HarnessFailureKind): string {
  if (kind === "positive-miss") return "The expected positive case did not clear its evidence contract.";
  if (kind === "control-false-positive") return "A safe control produced evidence that failed its rejection contract.";
  if (kind === "policy-invalid") return "The work item violated a trusted policy boundary.";
  return "The work item did not produce score-eligible execution evidence.";
}

function normalizeFailureCause(value: string): string {
  return value
    .replace(/(?:[A-Za-z]:)?\/(?:[^\s/:]+\/)+[^\s/:]+/g, "<path>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function normalizeEditableFile(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`editable file must be repository-relative: ${value}`);
  }
  if (!EDITABLE_HARNESS_FILES.has(normalized) && !EDITABLE_HARNESS_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`file is outside the bounded harness-edit surface: ${normalized}`);
  }
  return normalized;
}

function uniqueItemsByKey(items: HarnessEvidenceItem[], label: string): Map<string, HarnessEvidenceItem> {
  const result = new Map<string, HarnessEvidenceItem>();
  for (const item of items) {
    if (!item.itemKey) throw new Error(`${label} contains a work item without a stable key`);
    if (result.has(item.itemKey)) throw new Error(`${label} contains duplicate work-item key: ${item.itemKey}`);
    result.set(item.itemKey, item);
  }
  return result;
}

function ratio(candidate: number | null, baseline: number | null): number | null {
  if (candidate === null || baseline === null || baseline <= 0) return null;
  return candidate / baseline;
}

function formatRate(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}

function requireRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function optionalRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function jsonRecord(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== "string" || !input.trim()) return {};
  try {
    return optionalRecord(JSON.parse(input));
  } catch {
    return {};
  }
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== "string" || !input.trim()) throw new Error(`${label} is required`);
  return input.trim();
}

function firstString(...inputs: unknown[]): string | null {
  for (const input of inputs) if (typeof input === "string" && input.trim()) return input.trim();
  return null;
}

function stringList(input: unknown, label: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.some((value) => typeof value !== "string" || !value.trim())) throw new Error(`${label} must be a string array`);
  return input.map((value) => String(value).trim());
}

function arrayValue(input: unknown, label: string): unknown[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input;
}

function optionalStringField<K extends string>(key: K, input: unknown): { [P in K]?: string } {
  return typeof input === "string" && input.trim() ? { [key]: input.trim() } as { [P in K]?: string } : {};
}

function boundedInteger(input: unknown, fallback: number, min: number, max: number): number {
  if (input === undefined || input === null) return fallback;
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`integer policy value must be between ${min} and ${max}`);
  return value;
}

function boundedRatio(input: unknown, fallback: number, min: number, max: number): number {
  if (input === undefined || input === null) return fallback;
  const value = Number(input);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`ratio policy value must be between ${min} and ${max}`);
  return value;
}

function booleanValue(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function finiteInteger(input: unknown): number | null {
  const value = Number(input);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function dateMillis(input: unknown): number | null {
  if (typeof input !== "string" || !input) return null;
  const value = Date.parse(input);
  return Number.isFinite(value) ? value : null;
}

function stableJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stableJson).join(",")}]`;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(input) ?? "null";
}
