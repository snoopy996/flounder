# Product Validation

This document records the current product-validation state for Flounder as an
autonomous white-hat security auditor. It is a release-readiness note, not a
security disclosure or a claim that every target has been fully audited.

Validation source: the installed Flounder skill, the local Flounder control
plane, connected daemons, and current project state read through the REST API on
2026-06-23. The validation posture intentionally used neutral source and
official project materials. Known exploit writeups, incident explanations, and
answer-bearing material were not supplied as corpus.

## Environment

- Control plane reachable through the Flounder UI/API.
- Three execution daemons were online.
- No validation jobs were active when this report was written.
- `openai-codex` with high reasoning was the primary provider path.
- Current source/material state is versioned by Prepare and Map boundaries; old
  findings and scopes remain inspectable as historical data but no longer count
  in the current project view after a newer Prepare or Map.

## Results

| Target | Prepare | Coverage | Current result | Validation status |
| --- | --- | --- | --- | --- |
| Aztec public network, 2026-06-17 neutral target | Limited but audit-ready. Live Ethereum mainnet contracts and Aztec public RPC ground truth were collected with read-only guidance. | 115 scopes mapped, 5 audited, 110 pending. | 6 current findings: 3 locally confirmed, 2 real-target reproduced, 3 still suspected. Formal reports exist for reproduced findings. | Positive product validation. Flounder found and reproduced project-level governance/payload issues from neutral materials, but this target is not fully exhausted. |
| Aztec Connect, 2026-06-14 neutral target | Limited but audit-ready. Ethereum mainnet deployment, verified source, bridge adapters, and read-only fork guidance were collected. One unverified component remains a trust-boundary caveat. | 137 scopes mapped, 2 audited, 135 pending. | 3 locally confirmed findings. The critical `numRealTxs` finding was reproduced on the real target and has a report. Two medium findings remain unconfirmed on the real target. | Strong positive product validation for the target bug class. The key issue was found from neutral material and reproduced, but non-key findings still need confirm or dismissal. |
| Zcash Orchard / Halo2 neutral target | Limited but audit-ready. Source-only packages and official specifications were staged; no live target confirmation is required. | 75 scopes mapped, 1 audited, 74 pending. | 0 current findings. The audited high-priority ECC scope discharged the relevant obligation because the prepared source uses the current anchored-base implementation. | Incomplete for historical-bug recall. The product behaved correctly for the prepared current source, but this does not prove recall on the older vulnerable source. A neutral historical source pin is required to validate that specific recall case. |

## Product Issues Found And Fixed

- Scope inventory projection now respects the latest Map boundary. Older scopes
  no longer leak into current project coverage after a remap.
- Running Audit no longer makes the project appear unmapped before its first
  scope checkpoint.
- Prepare refresh now resets downstream phase status in the UI instead of
  showing stale Verify, Confirm, Report, or Synthesis state.
- Read-only file-existence checks are allowed in the command policy.
- Live map checkpoints are surfaced before daemon ingest finishes.

## Release Readiness Assessment

Flounder is close to an open-source release candidate for users who want an
AI-driven audit loop that can:

- prepare source and official materials without answer-bearing corpus,
- map a scope inventory,
- audit selected scopes,
- verify suspected findings by execution,
- reproduce real-target findings with read-only/fork-safe confirmation, and
- generate one report per reproduced bug.

The validation is not complete enough to claim universal recall. The strongest
release-safe claim is narrower: Flounder successfully found and reproduced
material issues on the Aztec validation targets using neutral inputs, while the
Zcash/Halo2 historical recall case still needs an exact neutral historical
source target.

## Minimal Remaining Work

Before calling this validation complete:

1. Add a neutral historical-source Zcash/Halo2 validation target that pins the
   older vulnerable source without including the exploit explanation.
2. Run Prepare and Map on that pinned target, then audit the relevant mapped
   scope without injecting answer-bearing material.
3. Confirm whether the model independently rediscovers the issue, records a
   finding, and can produce executable evidence.
4. For Aztec Connect, either confirm the two remaining medium findings or mark
   them as non-submittable with evidence.
5. For Aztec public network, keep the current reproduced findings as positive
   product evidence, but do not claim full target coverage because 110 scopes
   remain pending.

