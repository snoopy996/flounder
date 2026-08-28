export type SubmissionDecisionLike = {
  bug?: string | undefined;
  members?: string[] | undefined;
  reproduced?: string | null | undefined;
  recommendation?: string | null | undefined;
  humanGates?: string | null | undefined;
  engagementProfile?: unknown;
  adjudication?: unknown;
  evidenceLevel?: string | null | undefined;
  reproCommandId?: string | null | undefined;
};

export type BountyGate = "scope" | "live_impact" | "known_issue" | "payout";
export type TechnicalClaimGate = "attacker_reachability" | "end_to_end_effect" | "impact_bounds";
type DecisionGate = BountyGate | TechnicalClaimGate;

export interface TechnicalClaimGateEvidence {
  id: TechnicalClaimGate;
  status: string;
  evidence?: string | undefined;
}

const TECHNICAL_CLAIM_GATES: TechnicalClaimGate[] = ["attacker_reachability", "end_to_end_effect", "impact_bounds"];
const DEFAULT_BOUNTY_GATES: BountyGate[] = ["scope", "live_impact", "known_issue", "payout"];
const SOURCE_ONLY_BOUNTY_GATES: BountyGate[] = ["scope", "known_issue", "payout"];
const TECHNICAL_GATE_SUBJECT = String.raw`(?:scope|authori[sz]ation|permissions? to audit|target identity|source integrity|live (?:impact|deployment|target|funds?)|funded deployment|production deployment|current version|affected version|execution evidence|execution|reproduction|reproduc(?:e|ed|ibility)|verification|technical confirmation|proof of concept|poc|exploit|local fork|fork)`;
const UNRESOLVED_GATE_STATE = String.raw`(?:pending|missing|unknown|unclear|unverified|unconfirmed|incomplete|inconclusive|tbd|to be determined|failed|could not|cannot|not (?:yet )?(?:been )?(?:reproduced|verified|confirmed|executed|run)|must (?:be )?(?:reproduced|verified|confirmed|executed|run)|requires? (?:reproduction|verification|confirmation|execution))`;
const TECHNICAL_GATE_UNCERTAINTY = new RegExp(
  `\\b${TECHNICAL_GATE_SUBJECT}\\b.{0,48}\\b${UNRESOLVED_GATE_STATE}\\b|\\b${UNRESOLVED_GATE_STATE}\\b.{0,48}\\b${TECHNICAL_GATE_SUBJECT}\\b`,
);

export interface SubmissionReadinessOptions {
  impactInventory?: unknown;
  requireImpactInventory?: boolean;
  /** Operator-selected project engagement. A configured bounty cannot be silently
   * reclassified as a source review to bypass bounty readiness gates. */
  configuredEngagement?: unknown;
}

export type ProgramRequirementStatus = "met" | "not-met" | "unknown" | "not-required";
export type ProgramComplianceStatus = "met" | "not-met" | "unknown";
export type TechnicalEvidenceLevel =
  | "unknown"
  | "reasoned"
  | "source-supported"
  | "source-executed"
  | "local-integration-reproduced"
  | "local-fork-reproduced"
  | "deployed-target-reproduced";
export type SubmissionDisposition = "eligible-to-submit" | "strengthen-first" | "needs-human" | "do-not-submit";
export type AdjudicationRiskStatus = "clear" | "uncertain" | "adverse" | "not-applicable";

export interface SubmissionDecisionSummary {
  schemaVersion: 1;
  programCompliance: {
    status: ProgramComplianceStatus;
    label: string;
    requirements: Array<{
      id: "scope" | "live-impact" | "evidence" | "policy-terms";
      label: string;
      status: ProgramRequirementStatus;
      detail: string;
    }>;
    blockers: string[];
  };
  technicalEvidence: {
    level: TechnicalEvidenceLevel;
    label: string;
    boundary: string;
    satisfiesProgramMinimum: boolean | null;
    notDemonstrated: string[];
    claimValidity: {
      status: ProgramComplianceStatus | "not-required";
      label: string;
      requirements: Array<{
        id: "attacker-reachability" | "end-to-end-effect" | "impact-bounds";
        label: string;
        status: ProgramRequirementStatus;
        detail: string;
      }>;
    };
  };
  submission: {
    status: SubmissionDisposition;
    label: string;
    rationale: string;
  };
  adjudicationRisk: {
    status: AdjudicationRiskStatus;
    label: string;
    risks: string[];
  };
}

/**
 * Product-owned interpretation of a confirm row. Program compliance, technical
 * evidence, disclosure advice, and reward/adjudication uncertainty are
 * intentionally independent dimensions: a private duplicate or unknown award
 * is not evidence that a program's minimum submission requirements failed.
 */
export function submissionDecisionSummary(
  row: SubmissionDecisionLike,
  options: SubmissionReadinessOptions = {},
): SubmissionDecisionSummary {
  const bountyLike = isBountyLikePolicy(row) || configuredBountyProfile(options.configuredEngagement) !== undefined;
  const profile = asRecord(decisionEngagementProfile(row));
  const policyKind = normalizedWord(profile?.policy_kind ?? profile?.policyKind ?? profile?.kind);
  const policySources = stringList(profile?.policy_sources ?? profile?.policySources);
  const policyClassified = Boolean(policyKind && policyKind !== "unknown") || configuredBountyProfile(options.configuredEngagement) !== undefined;
  const policyDeclared = policyClassified && (!bountyLike || policySources.length > 0);
  const requiredGates = requiredBountyGates(row);
  const evidence = technicalEvidenceSummary(row, bountyLike);
  const requirements: SubmissionDecisionSummary["programCompliance"]["requirements"] = [];

  if (bountyLike) {
    let scopeStatus = classifyProgramGate(bountyGateStatus(decisionAdjudication(row), "scope"), "scope");
    let detail = programGateDetail("scope", scopeStatus);
    if (scopeStatus === "not-required") {
      scopeStatus = "unknown";
      detail = "A bounty or contest requires an in-scope asset, but the decision records scope as not required.";
    } else if (scopeStatus === "met" && !bountyGateEvidence(decisionAdjudication(row), "scope")) {
      scopeStatus = "unknown";
      detail = "Scope is marked as passing, but no supporting program or asset evidence is recorded.";
    }
    requirements.push({
      id: "scope",
      label: "Program scope",
      status: scopeStatus,
      detail,
    });
  } else {
    requirements.push({ id: "scope", label: "Program scope", status: "not-required", detail: "No bounty or contest scope gate is configured." });
  }

  const liveRequired = bountyLike && requiredGates.includes("live_impact");
  if (liveRequired) {
    let liveStatus = classifyProgramGate(bountyGateStatus(decisionAdjudication(row), "live_impact"), "live_impact");
    let detail = programGateDetail("live_impact", liveStatus);
    if (liveStatus === "not-required") {
      liveStatus = "unknown";
      detail = "The engagement requires live-impact evidence, but the decision records it as not required.";
    } else if (liveStatus === "met" && !bountyGateEvidence(decisionAdjudication(row), "live_impact")) {
      liveStatus = "unknown";
      detail = "Live impact is marked as passing, but no supporting evidence is recorded.";
    } else if (liveStatus === "met" && options.requireImpactInventory !== false && !impactInventoryCoversRow(row, options.impactInventory)) {
      liveStatus = "unknown";
      detail = "impact_inventory.json has no entry covering this decision.";
    }
    requirements.push({ id: "live-impact", label: "Required live impact", status: liveStatus, detail });
  } else {
    requirements.push({ id: "live-impact", label: "Required live impact", status: "not-required", detail: "The engagement does not require live-deployment impact evidence." });
  }

  const evidenceRequirement = evidenceRequirementStatus(row, bountyLike, evidence.level);
  requirements.push({
    id: "evidence",
    label: "Required evidence",
    status: evidenceRequirement.status,
    detail: evidenceRequirement.detail,
  });

  const policyGate = !policyDeclared
    ? policyClassified && bountyLike
      ? "The engagement is classified, but no official policy source is recorded for its mandatory terms."
      : "The engagement policy and its mandatory terms were not classified."
    : programHumanGate(row, liveRequired);
  requirements.push({
    id: "policy-terms",
    label: "Other mandatory terms",
    status: policyGate ? "unknown" : "met",
    detail: policyGate ?? "No unresolved scope, venue, embargo, or mandatory-policy term was recorded.",
  });

  evidence.satisfiesProgramMinimum = evidenceRequirement.status === "met"
    ? true
    : evidenceRequirement.status === "not-met"
      ? false
      : null;
  const blockers = requirements
    .filter((requirement) => requirement.status === "not-met" || requirement.status === "unknown")
    .map((requirement) => `${requirement.label}: ${requirement.detail}`);
  const nonEvidenceRequirements = requirements.filter((requirement) => requirement.id !== "evidence");
  const complianceStatus: ProgramComplianceStatus = nonEvidenceRequirements.some((requirement) => requirement.status === "not-met")
    ? "not-met"
    : nonEvidenceRequirements.some((requirement) => requirement.status === "unknown")
      ? "unknown"
      : evidenceRequirement.status === "not-met"
        ? "not-met"
        : evidenceRequirement.status === "unknown"
          ? "unknown"
          : "met";
  const complianceLabel = complianceStatus === "met"
    ? "Program minimum met"
    : complianceStatus === "not-met"
      ? "Program minimum not met"
      : "Program minimum unresolved";

  const adjudicationRisk = adjudicationRiskSummary(row, bountyLike);
  const claimValidity = evidence.claimValidity;
  const reproduced = decisionReproduced(row);
  const rawRecommendation = decisionRecommendation(row);
  let submissionStatus: SubmissionDisposition;
  let submissionRationale: string;
  if (reproduced === "no" || reproduced === "could-not-set-up" || rawRecommendation === "drop") {
    submissionStatus = "do-not-submit";
    submissionRationale = reproduced === "no"
      ? "The claim was not reproduced."
      : reproduced === "could-not-set-up"
        ? "The required reproduction could not be set up."
        : "The decision explicitly recommends dropping this candidate.";
  } else if (requirements.some((requirement) => requirement.id !== "evidence" && requirement.status === "not-met")) {
    submissionStatus = "do-not-submit";
    submissionRationale = blockers[0] ?? "A mandatory program requirement failed.";
  } else if (requirements.some((requirement) => requirement.id !== "evidence" && requirement.status === "unknown")) {
    submissionStatus = "needs-human";
    submissionRationale = blockers.find((blocker) => !blocker.startsWith("Required evidence:"))
      ?? "A mandatory program requirement remains unresolved.";
  } else if (claimValidity.status === "not-met") {
    submissionStatus = "do-not-submit";
    submissionRationale = claimValidity.requirements.find((requirement) => requirement.status === "not-met")?.detail
      ?? "The claimed exploit did not clear the technical-validity bar.";
  } else if (claimValidity.status === "unknown") {
    submissionStatus = "strengthen-first";
    submissionRationale = claimValidity.requirements.find((requirement) => requirement.status === "unknown")?.detail
      ?? "The claimed exploit still has unresolved technical-validity evidence.";
  } else if (evidenceRequirement.status === "not-met") {
    submissionStatus = "strengthen-first";
    submissionRationale = evidenceRequirement.detail;
  } else if (complianceStatus === "unknown") {
    submissionStatus = "needs-human";
    submissionRationale = blockers[0] ?? "A mandatory program requirement remains unresolved.";
  } else if (adjudicationRisk.status === "adverse") {
    submissionStatus = "do-not-submit";
    submissionRationale = adjudicationRisk.risks[0] ?? "Known adjudication evidence is adverse.";
  } else {
    submissionStatus = "eligible-to-submit";
    submissionRationale = adjudicationRisk.status === "uncertain"
      ? "Mandatory program requirements are met; reward or duplicate adjudication remains uncertain."
      : "Mandatory program requirements and the configured evidence minimum are met.";
  }
  const submissionLabel: Record<SubmissionDisposition, string> = {
    "eligible-to-submit": "Eligible to submit",
    "strengthen-first": "Strengthen evidence first",
    "needs-human": "Mandatory review needed",
    "do-not-submit": "Do not submit",
  };

  return {
    schemaVersion: 1,
    programCompliance: { status: complianceStatus, label: complianceLabel, requirements, blockers },
    technicalEvidence: evidence,
    submission: { status: submissionStatus, label: submissionLabel[submissionStatus], rationale: submissionRationale },
    adjudicationRisk,
  };
}

export function enforceSubmissionReadiness<T extends object>(
  rows: T[],
  options: SubmissionReadinessOptions = {},
): T[] {
  return rows.map((inputRow) => {
    const row = applyConfiguredEngagement(inputRow, options.configuredEngagement);
    const decision = row as SubmissionDecisionLike;
    const summary = submissionDecisionSummary(decision, options);
    if (decisionRecommendation(decision) === "needs-human" && summary.submission.status === "eligible-to-submit") {
      return { ...row, recommendation: "submit-candidate" } as T;
    }
    if (decisionRecommendation(decision) !== "submit-candidate") return row;
    const blocker = submissionReadinessBlocker(decision, options);
    if (!blocker) return row;
    const humanGates = appendHumanGate(decisionHumanGates(decision), `Framework blocked submit-candidate: ${blocker}`);
    return { ...row, recommendation: "needs-human", humanGates } as T;
  });
}

export function isSubmissionReadyDecision(row: object, options: SubmissionReadinessOptions = {}): boolean {
  return submissionDecisionSummary(row as SubmissionDecisionLike, {
    ...options,
    requireImpactInventory: options.requireImpactInventory ?? false,
  }).submission.status === "eligible-to-submit";
}

export function needsSubmissionReadinessWork(row: object): boolean {
  const decision = row as SubmissionDecisionLike;
  if (decisionReproduced(decision) !== "yes") return false;
  if (decisionRecommendation(decision) === "drop") return false;
  return submissionDecisionSummary(decision, { requireImpactInventory: false }).submission.status !== "eligible-to-submit";
}

export function isResumeSettledDecision(row: object): boolean {
  const decision = row as SubmissionDecisionLike;
  if (decisionReproduced(decision) === "no") return true;
  if (decisionRecommendation(decision) === "drop") return true;
  return decisionReproduced(decision) === "yes" && !needsConfirmEvidenceWork(decision);
}

/**
 * Whether Confirm must run again to improve technical evidence. Program-policy,
 * payout, and duplicate gates belong to adjudication and must not silently
 * re-run an already-settled exploit PoC. A focused retry may still reopen it.
 */
export function needsConfirmEvidenceWork(row: object): boolean {
  const decision = row as SubmissionDecisionLike;
  if (decisionReproduced(decision) !== "yes" || decisionRecommendation(decision) === "drop") return false;
  const summary = submissionDecisionSummary(decision, { requireImpactInventory: false });
  if (["unknown", "reasoned", "source-supported"].includes(summary.technicalEvidence.level)) return true;
  if (summary.technicalEvidence.satisfiesProgramMinimum === false) return true;
  return summary.technicalEvidence.claimValidity.status === "unknown";
}

export function submissionReadinessBlocker(row: SubmissionDecisionLike, options: SubmissionReadinessOptions = {}): string | undefined {
  const summary = submissionDecisionSummary(row, options);
  return summary.submission.status === "eligible-to-submit" ? undefined : summary.submission.rationale;
}

export function hasOpenSubmissionGate(row: SubmissionDecisionLike): boolean {
  return submissionDecisionSummary(row, { requireImpactInventory: false }).submission.status !== "eligible-to-submit";
}

export function isBountyLikePolicy(row: SubmissionDecisionLike): boolean {
  const profile = asRecord(decisionEngagementProfile(row));
  const adjudication = asRecord(decisionAdjudication(row));
  const policyKind = normalizedWord(stringValue(profile?.policy_kind ?? profile?.policyKind ?? profile?.kind));
  if (policyKind.includes("bug_bounty") || policyKind.includes("bounty") || policyKind.includes("contest")) return true;
  if (["private_audit", "incident", "source_review"].includes(policyKind)) return false;
  const requiredRaw = profile?.required_gates ?? profile?.requiredGates;
  const requiredGates = Array.isArray(requiredRaw) ? requiredRaw.map((entry) => normalizedWord(stringValue(entry))) : [];
  const adjudicationHasPayout = Boolean(adjudication && ("payout_estimate" in adjudication || "payoutEstimate" in adjudication || "reward_estimate" in adjudication || "rewardEstimate" in adjudication));
  if (policyKind === "custom" && (requiredGates.some(isRewardGate) || adjudicationHasPayout)) return true;
  if (requiredGates.some(isRewardGate) && adjudicationHasPayout) return true;
  return /\b(?:bounty|reward|payout|collectible)\b/.test(decisionHumanGates(row).toLowerCase());
}

function isRewardGate(gate: string): boolean {
  return gate.includes("payout") || gate.includes("reward") || gate.includes("bounty") || gate.includes("collectible");
}

function decisionReproduced(row: SubmissionDecisionLike): string {
  return stringField(row, ["reproduced"]).toLowerCase();
}

function decisionRecommendation(row: SubmissionDecisionLike): string {
  return stringField(row, ["recommendation"]).toLowerCase();
}

function decisionEvidenceLevel(row: SubmissionDecisionLike): string {
  return stringField(row, ["evidenceLevel", "evidence_level"]);
}

function isRealTargetEvidenceLevel(value: string): boolean {
  return value === "real_target_reproduced" || value === "fork_reproduced" || value === "local_fork_reproduced";
}

function isSourceOnlyEvidenceLevel(value: string): boolean {
  return value === "source_only_local_confirmed" || value === "source_confirmed";
}

const TECHNICAL_EVIDENCE_RANK: Record<TechnicalEvidenceLevel, number> = {
  unknown: 0,
  reasoned: 1,
  "source-supported": 2,
  "source-executed": 3,
  "local-integration-reproduced": 4,
  "local-fork-reproduced": 5,
  "deployed-target-reproduced": 6,
};

function canonicalTechnicalEvidence(value: string): TechnicalEvidenceLevel {
  const normalized = normalizedWord(value);
  if (["reasoned", "suspected", "hypothesis"].includes(normalized)) return "reasoned";
  if (["source_supported", "confirmed_source", "source_reviewed"].includes(normalized)) return "source-supported";
  if (["source_only_local_confirmed", "source_confirmed", "source_executed", "locally_reproduced", "execution_reproduced"].includes(normalized)) return "source-executed";
  if (["local_integration_reproduced", "integration_reproduced", "end_to_end_local_reproduced"].includes(normalized)) return "local-integration-reproduced";
  if (["local_fork_reproduced", "fork_reproduced"].includes(normalized)) return "local-fork-reproduced";
  if (["real_target_reproduced", "deployed_target_reproduced"].includes(normalized)) return "deployed-target-reproduced";
  return "unknown";
}

function technicalEvidenceSummary(
  row: SubmissionDecisionLike,
  bountyLike: boolean,
): SubmissionDecisionSummary["technicalEvidence"] {
  const claimedLevel = canonicalTechnicalEvidence(decisionEvidenceLevel(row));
  const missingExecutionProvenance = TECHNICAL_EVIDENCE_RANK[claimedLevel] >= TECHNICAL_EVIDENCE_RANK["source-executed"]
    && !decisionReproCommandId(row);
  const level = missingExecutionProvenance ? "unknown" : claimedLevel;
  const metadata: Record<TechnicalEvidenceLevel, { label: string; boundary: string }> = {
    unknown: {
      label: "Evidence boundary unknown",
      boundary: "The decision does not record which target boundary was executed.",
    },
    reasoned: {
      label: "Reasoned hypothesis",
      boundary: "The mechanism is reasoned about but has not been demonstrated by execution.",
    },
    "source-supported": {
      label: "Source-supported evidence",
      boundary: "The mechanism is grounded in source, but no executable reproduction is recorded.",
    },
    "source-executed": {
      label: "Source-level executable evidence",
      boundary: "Executed against published or pinned source in a local harness; this does not claim end-to-end integration or local-fork reproduction.",
    },
    "local-integration-reproduced": {
      label: "Local integration reproduction",
      boundary: "Reproduced through the relevant local components end to end; no local-fork reproduction is claimed.",
    },
    "local-fork-reproduced": {
      label: "Local-fork reproduction",
      boundary: "Reproduced against deployment state on a local fork; no transaction was broadcast to a live network.",
    },
    "deployed-target-reproduced": {
      label: "Deployed-target reproduction",
      boundary: "Reproduced against the authorized real-target ground truth without treating a live-system write as required evidence.",
    },
  };
  const rank = TECHNICAL_EVIDENCE_RANK[level];
  const boundaryGaps = level === "unknown"
    ? [missingExecutionProvenance
      ? "An execution level was claimed, but no passing confirmation command ID was recorded."
      : "No executable evidence boundary was recorded."]
    : rank < TECHNICAL_EVIDENCE_RANK["source-executed"]
      ? ["Source-level executable reproduction was not recorded.", "End-to-end local integration was not recorded.", "Local-fork reproduction was not recorded.", "Deployed-target reproduction was not recorded."]
      : rank < TECHNICAL_EVIDENCE_RANK["local-integration-reproduced"]
        ? ["End-to-end local integration was not recorded.", "Local-fork reproduction was not recorded.", "Deployed-target reproduction was not recorded."]
        : rank < TECHNICAL_EVIDENCE_RANK["local-fork-reproduced"]
          ? ["Local-fork reproduction was not recorded.", "Deployed-target reproduction was not recorded."]
          : rank < TECHNICAL_EVIDENCE_RANK["deployed-target-reproduced"]
            ? ["Deployed-target reproduction was not recorded."]
            : [];
  const claimValidity = technicalClaimValiditySummary(row, bountyLike);
  const validityGaps = claimValidity.requirements
    .filter((requirement) => requirement.status === "unknown" || requirement.status === "not-met")
    .map((requirement) => `${requirement.label}: ${requirement.detail}`);
  return {
    level,
    label: metadata[level].label,
    boundary: metadata[level].boundary,
    satisfiesProgramMinimum: bountyLike ? null : rank >= TECHNICAL_EVIDENCE_RANK["source-executed"],
    notDemonstrated: [...boundaryGaps, ...validityGaps],
    claimValidity,
  };
}

function technicalClaimValiditySummary(
  row: SubmissionDecisionLike,
  bountyLike: boolean,
): SubmissionDecisionSummary["technicalEvidence"]["claimValidity"] {
  const definitions = [
    {
      gate: "attacker_reachability" as const,
      id: "attacker-reachability" as const,
      label: "Attacker-reachable preconditions",
      unknown: "The decision does not establish that a real attacker can cause or reliably exploit every required precondition.",
    },
    {
      gate: "end_to_end_effect" as const,
      id: "end-to-end-effect" as const,
      label: "End-to-end security effect",
      unknown: "The passing PoC is not shown to commit the claimed unauthorized effect end to end; an intermediate value or calldata alone is insufficient.",
    },
    {
      gate: "impact_bounds" as const,
      id: "impact-bounds" as const,
      label: "Impact and recovery bounds",
      unknown: "The decision does not account for existing authorization, recovery, revocation, timing, and reversibility controls when stating impact.",
    },
  ];
  if (!bountyLike) {
    return {
      status: "not-required",
      label: "Bounty claim gates not required",
      requirements: definitions.map(({ id, label }) => ({ id, label, status: "not-required", detail: "No bounty or contest submission is being recommended." })),
    };
  }
  const adjudication = decisionAdjudication(row);
  const requirements = definitions.map(({ gate, id, label, unknown }) => {
    let status = classifyTechnicalClaimGate(bountyGateStatus(adjudication, gate));
    const evidence = bountyGateEvidence(adjudication, gate);
    let detail = evidence || unknown;
    if (status === "met" && !evidence) {
      status = "unknown";
      detail = `${label} is marked as passing, but no supporting evidence is recorded.`;
    } else if (status === "not-met" && !evidence) {
      detail = `${label} failed, but the decision did not record why.`;
    }
    return { id, label, status, detail };
  });
  const status = requirements.some((requirement) => requirement.status === "not-met")
    ? "not-met"
    : requirements.some((requirement) => requirement.status !== "met")
      ? "unknown"
      : "met";
  const label = status === "met"
    ? "Technical claim validated"
    : status === "not-met"
      ? "Technical claim invalidated"
      : "Technical claim validation incomplete";
  return { status, label, requirements };
}

function classifyTechnicalClaimGate(status: string | undefined): Exclude<ProgramRequirementStatus, "not-required"> {
  const normalized = normalizedWord(status);
  if (!normalized || matchesStatus(normalized, ["unknown", "needs_human", "missing", "unsettled", "pending", "unclear", "unverified", "not_required", "not_applicable"])) return "unknown";
  if (isPassingBountyGateStatus(status, "attacker_reachability")) return "met";
  if (matchesStatus(normalized, ["fail", "failed", "not_reachable", "not_observed", "not_demonstrated", "invalid", "refuted", "mitigated"])) return "not-met";
  return "unknown";
}

function evidenceRequirementStatus(
  row: SubmissionDecisionLike,
  bountyLike: boolean,
  level: TechnicalEvidenceLevel,
): { status: Exclude<ProgramRequirementStatus, "not-required">; detail: string } {
  const rank = TECHNICAL_EVIDENCE_RANK[level];
  const profile = asRecord(decisionEngagementProfile(row));
  const requirement = normalizedWord(profile?.evidence_requirement ?? profile?.evidenceRequirement);
  const reproduced = decisionReproduced(row);
  if (reproduced !== "yes") return { status: "not-met", detail: `The decision is ${reproduced || "not reproduced"}.` };

  let minimum: TechnicalEvidenceLevel | undefined;
  if (matchesStatus(requirement, ["source_only", "published_source", "pre_mainnet_source"])) minimum = "source-executed";
  else if (matchesStatus(requirement, ["local_integration", "integration", "end_to_end_local"])) minimum = "local-integration-reproduced";
  else if (matchesStatus(requirement, ["real_target", "local_fork", "fork", "deployed_target", "live_deployment"])) minimum = "local-fork-reproduced";
  else if (!bountyLike) minimum = "source-executed";
  else if (rank >= TECHNICAL_EVIDENCE_RANK["local-fork-reproduced"]) minimum = "local-fork-reproduced";

  if (!minimum) {
    return {
      status: "unknown",
      detail: `The engagement does not establish whether ${technicalEvidenceLabel(level)} satisfies its evidence minimum.`,
    };
  }
  if (rank >= TECHNICAL_EVIDENCE_RANK[minimum]) {
    return { status: "met", detail: `${technicalEvidenceLabel(level)} satisfies the configured ${technicalEvidenceLabel(minimum)} minimum.` };
  }
  return {
    status: "not-met",
    detail: `${technicalEvidenceLabel(level)} does not satisfy the configured ${technicalEvidenceLabel(minimum)} minimum.`,
  };
}

function technicalEvidenceLabel(level: TechnicalEvidenceLevel): string {
  return level.replace(/-/g, " ");
}

function classifyProgramGate(status: string | undefined, gate: "scope" | "live_impact"): ProgramRequirementStatus {
  const normalized = normalizedWord(status);
  if (!normalized || matchesStatus(normalized, ["unknown", "needs_human", "missing", "unsettled", "pending", "unclear", "unverified"])) return "unknown";
  if (matchesStatus(normalized, ["not_required", "not_applicable"])) return "not-required";
  if (isPassingBountyGateStatus(status, gate)) return "met";
  if (matchesStatus(normalized, ["fail", "failed", "out_of_scope", "ineligible", "unfunded", "not_funded", "not_live", "no_live", "no_funds"])) return "not-met";
  return "unknown";
}

function programGateDetail(gate: "scope" | "live_impact", status: ProgramRequirementStatus): string {
  if (status === "met") return gate === "scope" ? "The affected asset or component is recorded as in scope." : "The required live-impact gate is established.";
  if (status === "not-met") return gate === "scope" ? "The affected asset or component is recorded as out of scope or ineligible." : "The required live-impact gate failed.";
  if (status === "not-required") return "The engagement records this gate as not required.";
  return gate === "scope" ? "Program scope or venue eligibility is not established." : "Required live-deployment impact is not established.";
}

function programHumanGate(row: SubmissionDecisionLike, liveRequired: boolean): string | undefined {
  const text = decisionHumanGates(row).trim();
  if (!hasUnsettledHumanGateText(text)) return undefined;
  const normalized = text.toLowerCase();
  const profile = asRecord(decisionEngagementProfile(row));
  const policyKind = normalizedWord(profile?.policy_kind ?? profile?.policyKind ?? profile?.kind);
  const privateReview = ["private_audit", "incident", "source_review"].includes(policyKind);
  const disclosureHandling = /\b(?:private|confidential|contact|embargo|duplicate|known issue|disclosure)\b/.test(normalized);
  const technicalUncertainty = TECHNICAL_GATE_UNCERTAINTY.test(normalized);
  const mandatoryProgramTerms = /\b(?:mandatory|required)\b.{0,32}\b(?:embargo|submission window|deadline|scope|venue|eligibility|policy terms?|contest rules?|program requirements?)\b/.test(normalized)
    || /\b(?:embargo|submission window|deadline|scope|venue|eligibility|policy terms?|contest rules?|program requirements?)\b.{0,48}\b(?:pending|missing|unknown|unclear|unverified|unconfirmed|not established|required|mandatory)\b/.test(normalized);
  const explicitlyHandlingOnly = /\bno mandatory (?:submission|program|policy)(?: or (?:submission|program|policy))* (?:gate|gates|blocker|blockers) remain(?:s|ing)?\b/.test(normalized)
    && /\b(?:handling|disclosure|contact|duplicate|embargo)\b/.test(normalized)
    && !technicalUncertainty;
  if (explicitlyHandlingOnly) return undefined;
  if (privateReview && disclosureHandling && !technicalUncertainty && !mandatoryProgramTerms) return undefined;
  if (technicalUncertainty) return text;
  if (mandatoryProgramTerms) return text;
  const programTerms = /\b(?:scope|venue|eligib|embargo|submission window|deadline|policy terms?|contest rules?|mandatory requirement)\b/.test(normalized);
  const liveTerms = /\b(?:live|funded|funds|deployment|production|current version|affected version)\b/.test(normalized);
  const adjudicationOnly = /\b(?:known issue|known_issue|novelty|duplicate|payout|reward|bounty amount|collectible)\b/.test(normalized)
    && !programTerms
    && !(liveRequired && liveTerms);
  if (adjudicationOnly) return undefined;
  if (programTerms || (liveRequired && liveTerms)) return text;
  return "An unresolved human gate was recorded without enough structure to prove that all mandatory program terms are met.";
}

function adjudicationRiskSummary(row: SubmissionDecisionLike, bountyLike: boolean): SubmissionDecisionSummary["adjudicationRisk"] {
  if (!bountyLike) return { status: "not-applicable", label: "No bounty adjudication configured", risks: [] };
  const adjudication = decisionAdjudication(row);
  const knownStatus = normalizedWord(bountyGateStatus(adjudication, "known_issue"));
  const payoutStatus = normalizedWord(bountyGateStatus(adjudication, "payout"));
  const risks: string[] = [];
  let adverse = false;
  if (matchesStatus(knownStatus, ["already_disclosed", "duplicate", "disclosed", "not_novel", "known_issue"])) {
    adverse = true;
    risks.push("The candidate is recorded as a known issue, duplicate, or prior disclosure.");
  } else if (!knownStatus || !isPassingBountyGateStatus(knownStatus, "known_issue")) {
    risks.push("Public novelty and private-duplicate adjudication remain uncertain.");
  }
  if (!payoutStatus || !isPassingBountyGateStatus(payoutStatus, "payout")) {
    risks.push("Award eligibility or amount remains uncertain and is not guaranteed by technical confirmation.");
  } else {
    risks.push("Any award remains subject to venue adjudication; an estimate is not a guarantee.");
  }
  const status: AdjudicationRiskStatus = adverse ? "adverse" : risks.some((risk) => risk.includes("uncertain")) ? "uncertain" : "clear";
  const label = status === "adverse" ? "Adjudication evidence adverse" : status === "uncertain" ? "Reward/adjudication uncertain" : "No known adjudication blocker";
  return { status, label, risks };
}

export function isPermittedSubmissionEvidenceLevel(row: SubmissionDecisionLike, value: string): boolean {
  const normalized = normalizedWord(value);
  if (isRealTargetEvidenceLevel(normalized)) return true;
  const level = canonicalTechnicalEvidence(value);
  const profile = asRecord(decisionEngagementProfile(row));
  const requirement = normalizedWord(profile?.evidence_requirement ?? profile?.evidenceRequirement);
  if (matchesStatus(requirement, ["local_integration", "integration", "end_to_end_local"])) {
    return TECHNICAL_EVIDENCE_RANK[level] >= TECHNICAL_EVIDENCE_RANK["local-integration-reproduced"];
  }
  return allowsSourceOnlyEvidence(row, requiredBountyGates(row)) && isSourceOnlyEvidenceLevel(normalized);
}

function allowsSourceOnlyEvidence(row: SubmissionDecisionLike, requiredGates: BountyGate[]): boolean {
  const profile = asRecord(decisionEngagementProfile(row));
  const requirement = normalizedWord(profile?.evidence_requirement ?? profile?.evidenceRequirement);
  return matchesStatus(requirement, ["source_only", "published_source", "pre_mainnet_source"])
    && !requiredGates.includes("live_impact");
}

export function requiredBountyGates(row: SubmissionDecisionLike): BountyGate[] {
  const profile = asRecord(decisionEngagementProfile(row));
  const raw = profile?.required_gates ?? profile?.requiredGates;
  const declared = Array.isArray(raw)
    ? raw.map((value) => canonicalBountyGate(normalizedWord(value))).filter((value): value is BountyGate => Boolean(value))
    : [];
  const requirement = normalizedWord(profile?.evidence_requirement ?? profile?.evidenceRequirement);
  const baseline = matchesStatus(requirement, ["source_only", "published_source", "pre_mainnet_source"])
    ? SOURCE_ONLY_BOUNTY_GATES
    : DEFAULT_BOUNTY_GATES;
  return [...new Set(declared.length > 0 ? declared : baseline)];
}

/** Return the execution-grounded claim gates recorded by confirm. Operator review may
 * carry these gates forward, but it must not manufacture or replace them. */
export function decisionTechnicalClaimGates(row: SubmissionDecisionLike): TechnicalClaimGateEvidence[] {
  return TECHNICAL_CLAIM_GATES.flatMap((id) => {
    const status = bountyGateStatus(decisionAdjudication(row), id);
    if (!status) return [];
    const evidence = bountyGateEvidence(decisionAdjudication(row), id);
    return [{ id, status, ...(evidence ? { evidence } : {}) }];
  });
}

function canonicalBountyGate(value: string): BountyGate | undefined {
  if (["scope", "asset", "eligibility"].includes(value)) return "scope";
  if (["live_impact", "live_exposure", "funded_impact", "affected_deployment"].includes(value)) return "live_impact";
  if (["known_issue", "novelty", "duplicate", "disclosure"].includes(value)) return "known_issue";
  if (["payout", "reward", "collectible"].includes(value)) return "payout";
  return undefined;
}

function decisionHumanGates(row: SubmissionDecisionLike): string {
  return stringField(row, ["humanGates", "human_gates"]);
}

function decisionReproCommandId(row: SubmissionDecisionLike): string {
  return stringField(row, ["reproCommandId", "repro_command_id"]);
}

function decisionEngagementProfile(row: SubmissionDecisionLike): unknown {
  return structuredField(row, ["engagementProfile", "engagement_profile", "engagement_profile_json"]);
}

function decisionAdjudication(row: SubmissionDecisionLike): unknown {
  return structuredField(row, ["adjudication", "adjudication_json"]);
}

function stringField(row: SubmissionDecisionLike, keys: string[]): string {
  const record = row as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value.trim();
    if (value !== undefined && value !== null && typeof value !== "object") return String(value).trim();
  }
  return "";
}

function structuredField(row: SubmissionDecisionLike, keys: string[]): unknown {
  const record = row as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string") return jsonParseOrNull(value) ?? value;
    return value;
  }
  return undefined;
}

function hasUnsettledHumanGateText(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (/^(?:none|n\/a|not applicable|no remaining gates?|no human gates?)\.?$/.test(text)) return false;
  if (/\b(?:no|none)\b.{0,32}\b(?:remaining|open|unsettled|human)\b.{0,24}\b(?:gate|gates|blocker|blockers)\b/.test(text)) return false;
  return /\b(?:scope|venue|eligib|bounty|reward|payout|collectible|live|funded|funds|deployment|production|current|human gate|needs?|requires?|not (?:yet )?(?:been )?(?:established|confirmed|verified|reproduced|executed|run)|unknown|unclear|unverified|unconfirmed|incomplete|inconclusive|tbd|to be determined|pending|missing|failed|review|cannot|must)\b/.test(text);
}

function bountyGateStatus(adjudication: unknown, gate: DecisionGate): string | undefined {
  const record = asRecord(adjudication);
  if (!record) return undefined;
  const gates = Array.isArray(record.gates) ? record.gates.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
  const needles = gateNeedles(gate);
  for (const entry of gates) {
    const id = normalizedWord(stringValue(entry.id ?? entry.key ?? entry.name ?? entry.gate));
    if (gateIdMatches(id, gate, needles)) {
      const status = stringValue(entry.status ?? entry.result ?? entry.state);
      if (status) return status;
    }
  }
  return directGateStatus(record, gate);
}

function bountyGateEvidence(adjudication: unknown, gate: DecisionGate): string | undefined {
  const record = asRecord(adjudication);
  if (!record) return undefined;
  const gates = Array.isArray(record.gates) ? record.gates.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
  const needles = gateNeedles(gate);
  for (const entry of gates) {
    const id = normalizedWord(stringValue(entry.id ?? entry.key ?? entry.name ?? entry.gate));
    if (!gateIdMatches(id, gate, needles)) continue;
    const evidence = stringValue(entry.evidence ?? entry.basis ?? entry.source ?? entry.reason);
    if (evidence) return evidence;
  }
  return undefined;
}

function directGateStatus(record: Record<string, unknown>, gate: DecisionGate): string | undefined {
  const keys: Record<typeof gate, string[]> = {
    scope: ["scope_status", "scopeStatus", "asset_status", "assetStatus", "eligibility_status", "eligibilityStatus"],
    live_impact: ["live_impact_status", "liveImpactStatus", "funds_status", "fundsStatus", "exposure_status", "exposureStatus"],
    known_issue: ["known_issue_status", "knownIssueStatus", "novelty_status", "noveltyStatus", "duplicate_status", "duplicateStatus"],
    payout: ["payout_status", "payoutStatus", "reward_status", "rewardStatus"],
    attacker_reachability: ["attacker_reachability_status", "attackerReachabilityStatus", "attacker_control_status", "attackerControlStatus"],
    end_to_end_effect: ["end_to_end_effect_status", "endToEndEffectStatus", "effect_status", "effectStatus"],
    impact_bounds: ["impact_bounds_status", "impactBoundsStatus", "mitigation_review_status", "mitigationReviewStatus"],
  };
  for (const key of keys[gate]) {
    const status = stringValue(record[key]);
    if (status) return status;
  }
  if (gate === "payout") {
    const payout = asRecord(record.payout_estimate ?? record.payoutEstimate ?? record.reward_estimate ?? record.rewardEstimate);
    const status = stringValue(payout?.status);
    if (status) return status;
  }
  return undefined;
}

function gateNeedles(gate: DecisionGate): string[] {
  switch (gate) {
    case "scope": return ["scope", "venue", "eligib", "asset"];
    case "live_impact": return ["live", "impact", "fund", "exposure", "deployment"];
    case "known_issue": return ["known", "novel", "duplicate", "disclos"];
    case "payout": return ["payout", "reward", "collectible", "bounty"];
    case "attacker_reachability": return ["attacker_reachability", "attacker_control", "reachable_precondition"];
    case "end_to_end_effect": return ["end_to_end_effect", "observable_effect", "effect_execution"];
    case "impact_bounds": return ["impact_bounds", "mitigation_review", "recovery_bounds"];
  }
}

function gateIdMatches(id: string, gate: DecisionGate, needles: string[]): boolean {
  const technical = canonicalTechnicalClaimGate(id);
  if (technical) return technical === gate;
  return needles.some((needle) => id === needle || id.startsWith(`${needle}_`) || id.endsWith(`_${needle}`));
}

function canonicalTechnicalClaimGate(value: string): TechnicalClaimGate | undefined {
  if (["attacker_reachability", "attacker_control", "reachable_precondition", "reachable_preconditions"].includes(value)) return "attacker_reachability";
  if (["end_to_end_effect", "observable_effect", "effect_execution", "security_effect"].includes(value)) return "end_to_end_effect";
  if (["impact_bounds", "mitigation_review", "recovery_bounds", "reversibility_review"].includes(value)) return "impact_bounds";
  return undefined;
}

function isPassingBountyGateStatus(status: string | undefined, gate: DecisionGate): boolean {
  const normalized = normalizedWord(status);
  if (!normalized) return false;
  if (isNegativeGateStatus(normalized)) return false;
  if (matchesStatus(normalized, ["pass", "passed", "satisfied", "confirmed", "established", "eligible", "ok", "yes"])) return true;
  if (gate === "scope" && matchesStatus(normalized, ["in_scope", "eligible"])) return true;
  if (gate === "live_impact" && matchesStatus(normalized, ["funded", "live", "live_funded", "affected_live_deployment"])) return true;
  if (gate === "known_issue" && matchesStatus(normalized, ["novel", "not_duplicate", "not_disclosed", "no_known_issue", "not_known"])) return true;
  if (gate === "payout" && matchesStatus(normalized, ["estimated", "collectible"])) return true;
  return false;
}

function isNegativeGateStatus(normalized: string): boolean {
  return matchesStatus(normalized, [
    "fail",
    "failed",
    "unknown",
    "needs_human",
    "blocked",
    "missing",
    "unsettled",
    "not_applicable",
    "unfunded",
    "not_funded",
    "not_live",
    "no_live",
    "no_funds",
    "not_novel",
    "not_estimated",
    "already_disclosed",
    "duplicate",
    "disclosed",
  ]);
}

function matchesStatus(normalized: string, tokens: string[]): boolean {
  return tokens.some((token) => normalized === token || normalized.startsWith(`${token}_`));
}

function impactInventoryCoversRow(row: SubmissionDecisionLike, impactInventory: unknown): boolean {
  const inventory = asRecord(impactInventory);
  const inventoryItems = inventory?.items;
  const itemsRaw = Array.isArray(inventoryItems)
    ? inventoryItems
    : Array.isArray(impactInventory)
      ? impactInventory
      : [];
  if (itemsRaw.length === 0) return false;
  const rowMembers = new Set(decisionMembers(row).map((member) => normalizedWord(member)).filter(Boolean));
  const record = row as Record<string, unknown>;
  const rowBug = normalizedWord(stringValue(row.bug ?? record.title));
  for (const raw of itemsRaw) {
    const item = asRecord(raw);
    if (!item) continue;
    const bug = normalizedWord(stringValue(item.bug ?? item.title));
    if (bug && rowBug && bug === rowBug) return true;
    const members = Array.isArray(item.members) ? item.members.map((member) => normalizedWord(stringValue(member))).filter(Boolean) : [];
    if (members.some((member) => rowMembers.has(member))) return true;
  }
  return false;
}

function decisionMembers(row: SubmissionDecisionLike): string[] {
  if (Array.isArray(row.members)) return row.members.filter((member): member is string => typeof member === "string");
  const raw = (row as Record<string, unknown>).members_json;
  if (typeof raw === "string") {
    const parsed = jsonParseOrNull(raw);
    if (Array.isArray(parsed)) return parsed.filter((member): member is string => typeof member === "string");
  }
  return [];
}

function appendHumanGate(existing: string | undefined, note: string): string {
  const trimmed = existing?.trim();
  if (!trimmed) return note;
  if (trimmed.includes(note)) return trimmed;
  return `${trimmed} ${note}`;
}

function applyConfiguredEngagement<T extends object>(row: T, configuredEngagement: unknown): T {
  const configured = configuredBountyProfile(configuredEngagement);
  if (!configured) return row;
  const decision = row as SubmissionDecisionLike;
  if (isBountyLikePolicy(decision)) return row;
  const existing = asRecord(decisionEngagementProfile(decision)) ?? {};
  const reportedKind = stringValue(existing.policy_kind ?? existing.policyKind ?? existing.kind) || "missing";
  const note = `Framework applied the project's configured ${configured.policy_kind} engagement; Confirm reported ${reportedKind}. Verify current public terms before submission.`;
  return {
    ...row,
    engagementProfile: { ...existing, ...configured },
    humanGates: appendHumanGate(decisionHumanGates(decision), note),
  } as T;
}

function configuredBountyProfile(value: unknown): Record<string, unknown> | undefined {
  const engagement = asRecord(value);
  if (!engagement) return undefined;
  const kind = normalizedWord(engagement.kind ?? engagement.type);
  const policyKind = kind.includes("contest") ? "contest" : kind.includes("bounty") ? "bug_bounty" : undefined;
  if (!policyKind) return undefined;
  const venue = stringValue(engagement.venue ?? engagement.platform);
  const policyUrl = stringValue(engagement.contestUrl ?? engagement.url ?? engagement.policyUrl);
  return {
    policy_kind: policyKind,
    ...(venue ? { platform: venue } : {}),
    selected_by: "Project engagement configuration; current public terms still require verification.",
    confidence: "high",
    policy_sources: policyUrl ? [policyUrl] : [],
    required_gates: ["scope", "live_impact", "known_issue", "payout"],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function normalizedWord(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function jsonParseOrNull(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
