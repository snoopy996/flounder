import assert from "node:assert/strict";
import test from "node:test";
import {
  enforceSubmissionReadiness,
  submissionDecisionSummary,
} from "../dist/util/submission-readiness.js";

function sourceOnlyContest(overrides = {}) {
  return {
    bug: "Authorization bypass",
    reproduced: "yes",
    recommendation: "needs-human",
    evidenceLevel: "source-only-local-confirmed",
    reproCommandId: "confirm-1",
    humanGates: "Private duplicate and payout adjudication remain pending.",
    engagementProfile: {
      policy_kind: "contest",
      policy_sources: ["https://example.test/contest/rules"],
      evidence_requirement: "source_only",
      required_gates: ["scope", "known_issue", "payout"],
    },
    adjudication: {
      gates: [{ id: "scope", status: "pass", evidence: "The official asset list includes the affected component." }],
      scope_status: "pass",
      live_impact_status: "not-required",
      known_issue_status: "needs-human",
      payout_estimate: { status: "unknown" },
    },
    ...overrides,
  };
}

test("submission decision separates program compliance from evidence and reward uncertainty", () => {
  const summary = submissionDecisionSummary(sourceOnlyContest(), { requireImpactInventory: false });

  assert.equal(summary.programCompliance.status, "met");
  assert.equal(summary.technicalEvidence.level, "source-executed");
  assert.equal(summary.technicalEvidence.satisfiesProgramMinimum, true);
  assert.deepEqual(summary.technicalEvidence.notDemonstrated, [
    "End-to-end local integration was not recorded.",
    "Local-fork reproduction was not recorded.",
    "Deployed-target reproduction was not recorded.",
  ]);
  assert.equal(summary.submission.status, "eligible-to-submit");
  assert.equal(summary.adjudicationRisk.status, "uncertain");
  assert.match(summary.submission.rationale, /reward or duplicate adjudication remains uncertain/i);

  const [normalized] = enforceSubmissionReadiness([sourceOnlyContest()], { requireImpactInventory: false });
  assert.equal(normalized.recommendation, "submit-candidate");
  assert.match(normalized.humanGates, /Private duplicate and payout/);
});

test("source execution cannot satisfy a program that requires a local fork", () => {
  const row = sourceOnlyContest({
    recommendation: "submit-candidate",
    engagementProfile: {
      policy_kind: "bug_bounty",
      policy_sources: ["https://example.test/bounty/policy"],
      evidence_requirement: "real_target",
      required_gates: ["scope", "live_impact", "known_issue", "payout"],
    },
    adjudication: {
      gates: [
        { id: "scope", status: "pass", evidence: "The official asset list includes the target." },
        { id: "live_impact", status: "pass", evidence: "The affected deployment is recorded in the impact inventory." },
      ],
      scope_status: "pass",
      live_impact_status: "pass",
      known_issue_status: "novel",
      payout_estimate: { status: "estimated" },
    },
    humanGates: "",
  });
  const summary = submissionDecisionSummary(row, {
    requireImpactInventory: true,
    impactInventory: { items: [{ bug: row.bug }] },
  });
  assert.equal(summary.programCompliance.status, "not-met");
  assert.equal(summary.submission.status, "strengthen-first");
  assert.match(summary.submission.rationale, /source executed does not satisfy.*local fork/i);
});

test("missing policy or scope remains a mandatory review instead of a generic confirmation", () => {
  const missingPolicy = submissionDecisionSummary({
    bug: "Ambiguous result",
    reproduced: "yes",
    recommendation: "submit-candidate",
    evidenceLevel: "source-only-local-confirmed",
  }, { requireImpactInventory: false });
  assert.equal(missingPolicy.programCompliance.status, "unknown");
  assert.equal(missingPolicy.submission.status, "needs-human");
  assert.match(missingPolicy.programCompliance.blockers.join(" "), /engagement policy/i);

  const missingScope = submissionDecisionSummary(sourceOnlyContest({
    adjudication: { known_issue_status: "novel", payout_estimate: { status: "estimated" } },
    humanGates: "Scope review remains pending.",
  }), { requireImpactInventory: false });
  assert.equal(missingScope.programCompliance.status, "unknown");
  assert.equal(missingScope.submission.status, "needs-human");
});

test("a failed mandatory scope gate wins over an independently weak evidence level", () => {
  const summary = submissionDecisionSummary(sourceOnlyContest({
    engagementProfile: {
      policy_kind: "bug_bounty",
      policy_sources: ["https://example.test/bounty/policy"],
      evidence_requirement: "real_target",
      required_gates: ["scope", "live_impact"],
    },
    adjudication: {
      gates: [
        { id: "scope", status: "fail", evidence: "The official asset list excludes this component." },
        { id: "live_impact", status: "pass", evidence: "A deployment is listed." },
      ],
      scope_status: "fail",
      live_impact_status: "pass",
    },
    humanGates: "",
  }), {
    requireImpactInventory: true,
    impactInventory: { items: [{ bug: "Authorization bypass" }] },
  });

  assert.equal(summary.programCompliance.status, "not-met");
  assert.equal(summary.submission.status, "do-not-submit");
  assert.match(summary.submission.rationale, /scope/i);
});

test("claimed execution and passing gate statuses need durable provenance", () => {
  const noCommand = submissionDecisionSummary(sourceOnlyContest({ reproCommandId: "" }), { requireImpactInventory: false });
  assert.equal(noCommand.technicalEvidence.level, "unknown");
  assert.equal(noCommand.submission.status, "strengthen-first");
  assert.match(noCommand.technicalEvidence.notDemonstrated.join(" "), /command id/i);

  const noPolicySource = submissionDecisionSummary(sourceOnlyContest({
    engagementProfile: {
      policy_kind: "contest",
      evidence_requirement: "source_only",
      required_gates: ["scope"],
    },
  }), { requireImpactInventory: false });
  assert.equal(noPolicySource.programCompliance.status, "unknown");
  assert.equal(noPolicySource.submission.status, "needs-human");
  assert.match(noPolicySource.programCompliance.blockers.join(" "), /official policy source/i);

  const noScopeEvidence = submissionDecisionSummary(sourceOnlyContest({
    adjudication: { scope_status: "pass", known_issue_status: "novel", payout_estimate: { status: "estimated" } },
    humanGates: "",
  }), { requireImpactInventory: false });
  assert.equal(noScopeEvidence.programCompliance.status, "unknown");
  assert.equal(noScopeEvidence.submission.status, "needs-human");
  assert.match(noScopeEvidence.programCompliance.blockers.join(" "), /no supporting program or asset evidence/i);

  const conflictingScope = submissionDecisionSummary(sourceOnlyContest({
    adjudication: {
      gates: [{ id: "scope", status: "needs-human", evidence: "The affected asset has not been matched to the official list." }],
      scope_status: "pass",
      known_issue_status: "novel",
      payout_estimate: { status: "estimated" },
    },
    humanGates: "",
  }), { requireImpactInventory: false });
  assert.equal(conflictingScope.programCompliance.status, "unknown");
  assert.equal(conflictingScope.submission.status, "needs-human");
});

test("an explicit known duplicate is adverse without changing the technical evidence label", () => {
  const summary = submissionDecisionSummary(sourceOnlyContest({
    recommendation: "submit-candidate",
    humanGates: "",
    adjudication: {
      gates: [{ id: "scope", status: "pass", evidence: "The official asset list includes the affected component." }],
      scope_status: "pass",
      live_impact_status: "not-required",
      known_issue_status: "already-disclosed",
      payout_estimate: { status: "unknown" },
    },
  }), { requireImpactInventory: false });

  assert.equal(summary.programCompliance.status, "met");
  assert.equal(summary.technicalEvidence.label, "Source-level executable evidence");
  assert.equal(summary.adjudicationRisk.status, "adverse");
  assert.equal(summary.submission.status, "do-not-submit");
});
