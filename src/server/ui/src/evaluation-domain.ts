import type { RunGroupRow, WorkItemRow } from "./api";

export type EvaluationTone = "neutral" | "active" | "success" | "danger" | "warning";

export interface EvaluationMetrics {
  total: number;
  completed: number;
  active: number;
  blocked: number;
  invalid: number;
  scored: number;
  passed: number;
  failed: number;
  positives: number;
  positivesPassed: number;
  controls: number;
  controlsPassed: number;
  progress: number;
  passRate: number | null;
  positiveRecall: number | null;
  controlPassRate: number | null;
}

const GROUP_LABELS: Record<string, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  finished: "Finished",
  failed: "Needs attention",
  cancelled: "Cancelled",
};

const ITEM_LABELS: Record<string, string> = {
  queued: "Queued",
  claimed: "Claimed",
  running: "Running",
  finished: "Finished",
  failed: "Blocked",
  cancelled: "Cancelled",
};

export function isWorkItemTerminal(item: WorkItemRow): boolean {
  return item.state === "finished" || item.state === "failed" || item.state === "cancelled";
}

export function isWorkItemBlocked(item: WorkItemRow): boolean {
  return item.outcome === "blocked" || item.state === "failed" || item.state === "cancelled";
}

export function isWorkItemScored(item: WorkItemRow): boolean {
  return item.state === "finished"
    && item.outcome !== "blocked"
    && item.outcome !== "invalid"
    && typeof item.result?.accepted === "boolean";
}

export function evaluationMetrics(group: RunGroupRow): EvaluationMetrics {
  const items = group.items ?? [];
  const completed = items.filter(isWorkItemTerminal).length;
  const active = items.filter((item) => item.state === "queued" || item.state === "claimed" || item.state === "running").length;
  const blocked = items.filter(isWorkItemBlocked).length;
  const invalid = items.filter((item) => item.outcome === "invalid").length;
  const scoredItems = items.filter(isWorkItemScored);
  const passed = scoredItems.filter((item) => item.result?.accepted === true).length;
  const positiveItems = scoredItems.filter((item) => item.evidenceContract.expectedOutcome === "detect-positive");
  const positivePassed = positiveItems.filter((item) => item.result?.accepted === true).length;
  const controlItems = scoredItems.filter((item) => item.evidenceContract.expectedOutcome === "reject-positive");
  const controlPassed = controlItems.filter((item) => item.result?.accepted === true).length;

  return {
    total: items.length,
    completed,
    active,
    blocked,
    invalid,
    scored: scoredItems.length,
    passed,
    failed: scoredItems.length - passed,
    positives: positiveItems.length,
    positivesPassed: positivePassed,
    controls: controlItems.length,
    controlsPassed: controlPassed,
    progress: items.length === 0 ? 0 : Math.round((completed / items.length) * 100),
    passRate: scoredItems.length === 0 ? null : passed / scoredItems.length,
    positiveRecall: positiveItems.length === 0 ? null : positivePassed / positiveItems.length,
    controlPassRate: controlItems.length === 0 ? null : controlPassed / controlItems.length,
  };
}

export function groupStateLabel(state: string): string {
  return GROUP_LABELS[state] ?? sentenceCase(state);
}

export function groupStateTone(group: RunGroupRow): EvaluationTone {
  if (group.state === "running" || group.state === "queued") return "active";
  if (group.state === "paused") return "warning";
  if (group.state === "failed") return "danger";
  return "neutral";
}

export function workItemStateLabel(item: WorkItemRow): string {
  if (isWorkItemScored(item)) return item.result?.accepted === true ? "Passed" : "Scored failure";
  if (item.outcome === "invalid") return "Invalid";
  if (item.outcome === "blocked" || item.state === "failed") return "Blocked";
  return ITEM_LABELS[item.state] ?? sentenceCase(item.state);
}

export function workItemTone(item: WorkItemRow): EvaluationTone {
  if (item.state === "queued" || item.state === "claimed" || item.state === "running") return "active";
  if (item.outcome === "blocked" || item.state === "failed") return "warning";
  if (item.state === "cancelled" || item.outcome === "invalid") return "neutral";
  if (isWorkItemScored(item)) return item.result?.accepted === true ? "success" : "danger";
  return "neutral";
}

export function canStartRunGroup(group: RunGroupRow): boolean {
  return (group.state === "draft" || group.state === "paused") && group.items.length > 0;
}

export function canPauseRunGroup(group: RunGroupRow): boolean {
  return group.state === "running" || group.state === "queued";
}

export function canCancelRunGroup(group: RunGroupRow): boolean {
  return group.state === "draft" || group.state === "queued" || group.state === "running" || group.state === "paused";
}

export function canAddWorkItem(group: RunGroupRow): boolean {
  return group.state === "draft" || group.state === "paused";
}

export function canRetryWorkItem(group: RunGroupRow, item: WorkItemRow): boolean {
  return group.state !== "cancelled"
    && item.outcome === "blocked"
    && (item.state === "failed" || item.state === "cancelled");
}

function sentenceCase(value: string): string {
  const text = value.replace(/[_-]+/g, " ").trim();
  return text ? text.slice(0, 1).toUpperCase() + text.slice(1) : "Unknown";
}
