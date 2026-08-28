import assert from "node:assert/strict";
import test from "node:test";
import {
  enforceSubmissionReadiness,
  submissionDecisionSummary,
} from "../dist/util/submission-readiness.js";

function validTechnicalClaimGates() {
  return [
    { id: "attacker_reachability", status: "pass", evidence: "The test reaches every precondition using only the untrusted caller's permissions." },
    { id: "end_to_end_effect", status: "pass", evidence: "The passing confirmation command observes the claimed unauthorized state transition." },
    { id: "impact_bounds", status: "pass", evidence: "Existing recovery and revocation controls were exercised and do not erase the stated impact." },
  ];
}

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
      gates: [
        { id: "scope", status: "pass", evidence: "The official asset list includes the affected component." },
        ...validTechnicalClaimGates(),
      ],
      scope_status: "pass",
      live_impact_status: "not-required",
      known_issue_status: "needs-human",
      payout_estimate: { status: "unknown" },
    },
    ...overrides,
  };
}

function privateAuditDecision(humanGates, overrides = {}) {
  return sourceOnlyContest({
    evidenceLevel: "local-fork-reproduced",
    humanGates,
    engagementProfile: {
      policy_kind: "private_audit",
      policy_sources: ["SECURITY.md"],
      evidence_requirement: "real_target",
      required_gates: ["scope", "private disclosure channel"],
    },
    adjudication: {
      gates: [
        { id: "scope", status: "pass", evidence: "The affected component is in the authorized audit scope." },
        ...validTechnicalClaimGates(),
      ],
      scope_status: "pass",
      known_issue_status: "unknown",
      payout_estimate: { status: "not-applicable" },
    },
    ...overrides,
  });
}

test("submission decision separates program compliance from evidence and reward uncertainty", () => {
  const summary = submissionDecisionSummary(sourceOnlyContest(), { requireImpactInventory: false });

  assert.equal(summary.programCompliance.status, "met");
  assert.equal(summary.technicalEvidence.level, "source-executed");
  assert.equal(summary.technicalEvidence.satisfiesProgramMinimum, true);
  assert.equal(summary.technicalEvidence.claimValidity.status, "met");
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

test("private disclosure handling notes do not erase a local-fork technical verdict", () => {
  const row = {
    bug: "Shared backing can become undercollateralized",
    reproduced: "yes",
    recommendation: "needs-human",
    evidenceLevel: "local-fork-reproduced",
    reproCommandId: "cmd-fork-1",
    humanGates: "The team must confirm that this is not already known or privately reported and provide its preferred confidential contact/embargo process. This duplicate uncertainty is separate from technical reproduction. No public bounty or award terms were found, so no payout gate applies.",
    engagementProfile: {
      policy_kind: "private_audit",
      policy_sources: ["SECURITY.md"],
      evidence_requirement: "real_target",
      required_gates: ["scope", "private disclosure channel"],
    },
    adjudication: {
      gates: [{ id: "scope", status: "pass", evidence: "The deployed component is in the authorized audit scope." }],
      scope_status: "pass",
      known_issue_status: "unknown",
      payout_estimate: { status: "not-applicable" },
    },
  };

  const summary = submissionDecisionSummary(row, { requireImpactInventory: false });
  assert.equal(summary.technicalEvidence.level, "local-fork-reproduced");
  assert.equal(summary.programCompliance.status, "met");
  assert.equal(summary.submission.status, "eligible-to-submit");

  const [normalized] = enforceSubmissionReadiness([row], { requireImpactInventory: false });
  assert.equal(normalized.recommendation, "submit-candidate");
  assert.match(normalized.humanGates, /confidential contact\/embargo/i);
});

test("private disclosure handling does not hide an unresolved deployment reproduction gate", () => {
  const row = {
    ...sourceOnlyContest(),
    evidenceLevel: "local-fork-reproduced",
    humanGates: "The private disclosure contact is unresolved, and live deployment reproduction remains pending.",
    engagementProfile: {
      policy_kind: "private_audit",
      policy_sources: ["SECURITY.md"],
      evidence_requirement: "real_target",
      required_gates: ["scope", "private disclosure channel"],
    },
    adjudication: {
      gates: [{ id: "scope", status: "pass", evidence: "The affected component is authorized." }],
      scope_status: "pass",
      known_issue_status: "unknown",
      payout_estimate: { status: "not-applicable" },
    },
  };

  const summary = submissionDecisionSummary(row, { requireImpactInventory: false });
  assert.equal(summary.programCompliance.status, "unknown");
  assert.equal(summary.submission.status, "needs-human");
  assert.match(summary.submission.rationale, /live deployment reproduction remains pending/i);
});

test("private review preserves unresolved technical gates across common wording", () => {
  const unresolvedGates = [
    "Private contact remains pending; exploit verification is missing.",
    "The proof of concept remains unverified.",
    "Fork reproduction is pending.",
    "The exploit must be reproduced before disclosure.",
    "Execution evidence is unknown.",
    "Authorization remains pending.",
    "Permission to audit has not been confirmed.",
    "Target identity is unclear.",
    "Source integrity is unverified.",
    "The current version remains unconfirmed.",
    "The affected version is unknown.",
    "The proof of concept status is TBD.",
    "Technical confirmation is inconclusive.",
    "Verification remains incomplete.",
  ];

  for (const humanGates of unresolvedGates) {
    const summary = submissionDecisionSummary(privateAuditDecision(humanGates), { requireImpactInventory: false });
    assert.equal(summary.programCompliance.status, "unknown", humanGates);
    assert.equal(summary.submission.status, "needs-human", humanGates);
    assert.match(summary.submission.rationale, new RegExp(humanGates.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("private review does not turn resolved technical statements into open gates", () => {
  const resolvedNotes = [
    "Exploit reproduction completed successfully.",
    "Verification is complete.",
    "Authorization was confirmed.",
    "Execution evidence is sufficient.",
    "The authorized disclosure contact remains pending.",
  ];

  for (const humanGates of resolvedNotes) {
    const summary = submissionDecisionSummary(privateAuditDecision(humanGates), { requireImpactInventory: false });
    assert.equal(summary.programCompliance.status, "met", humanGates);
    assert.equal(summary.submission.status, "eligible-to-submit", humanGates);
  }
});

test("private disclosure handling distinguishes preferred process from a mandatory embargo", () => {
  const handlingOnly = submissionDecisionSummary(privateAuditDecision(
    "Preferred confidential contact and embargo handling remain pending. No mandatory submission or policy gates remain.",
  ), { requireImpactInventory: false });
  assert.equal(handlingOnly.submission.status, "eligible-to-submit");

  const mandatoryEmbargo = submissionDecisionSummary(privateAuditDecision(
    "The confidential disclosure embargo deadline remains pending.",
  ), { requireImpactInventory: false });
  assert.equal(mandatoryEmbargo.programCompliance.status, "unknown");
  assert.equal(mandatoryEmbargo.submission.status, "needs-human");
  assert.match(mandatoryEmbargo.submission.rationale, /embargo deadline remains pending/i);
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
        ...validTechnicalClaimGates(),
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
        ...validTechnicalClaimGates(),
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
      gates: [
        { id: "scope", status: "pass", evidence: "The official asset list includes the affected component." },
        ...validTechnicalClaimGates(),
      ],
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

test("bounty submission requires attacker reachability, an end-to-end effect, and bounded impact", () => {
  const missing = submissionDecisionSummary(sourceOnlyContest({
    adjudication: {
      gates: [{ id: "scope", status: "pass", evidence: "The official asset list includes the component." }],
      scope_status: "pass",
      live_impact_status: "not-required",
      known_issue_status: "novel",
      payout_estimate: { status: "estimated" },
    },
    humanGates: "",
  }), { requireImpactInventory: false });
  assert.equal(missing.technicalEvidence.claimValidity.status, "unknown");
  assert.equal(missing.submission.status, "strengthen-first");
  assert.match(missing.submission.rationale, /real attacker/i);

  const intermediateOnly = submissionDecisionSummary(sourceOnlyContest({
    adjudication: {
      gates: [
        { id: "scope", status: "pass", evidence: "The official asset list includes the component." },
        { id: "attacker_reachability", status: "pass", evidence: "The preconditions are attacker reachable." },
        { id: "end_to_end_effect", status: "fail", evidence: "The PoC only encoded an intermediate call and did not commit the claimed effect." },
        { id: "impact_bounds", status: "unknown", evidence: "Recovery controls were not evaluated." },
      ],
      scope_status: "pass",
      live_impact_status: "not-required",
      known_issue_status: "novel",
      payout_estimate: { status: "estimated" },
    },
    humanGates: "",
  }), { requireImpactInventory: false });
  assert.equal(intermediateOnly.technicalEvidence.claimValidity.status, "not-met");
  assert.equal(intermediateOnly.submission.status, "do-not-submit");
  assert.match(intermediateOnly.submission.rationale, /intermediate call/i);
});
