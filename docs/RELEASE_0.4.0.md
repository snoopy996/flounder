# Flounder 0.4.0

## Changes since 0.3.1

- Versioned coverage inventories, independent map samples, scope outcome
  handoffs, adaptive dig sampling, and explicit continuation of settled rounds.
- Material-isolated evaluation attempts and stronger evidence-based finding
  lifecycle reconciliation across verify, confirm, and report.
- Current-state and attacker-reachability evidence in confirmation decisions,
  with program compliance separate from reward and private duplicate uncertainty.
- Project-attributed storage reporting and cleanup, retained database history,
  and targeted compaction of terminal inspection copies.
- Target-pinned Rust sandbox image builds and expanded isolated build support.
- Local default provider profiles and custom model routing to the selected
  daemon. Sol remains the product default; Astra is an optional medium-thinking
  starter profile. The pi peer dependency range is now `>=0.85.1 <0.86`.
- Complete compiled runtime packaging. CI now checks the tarball's relative
  module imports, CLI startup, public exports, UI assets, offline mock audit,
  and public surface instead of relying on a successful source build alone.
- Shared phase goals across the legacy and pi-session drivers. Removed mandatory
  discovery lenses, prescribed investigation sequences, and fixed novelty-search
  counts. Execution confirmation, attacker realism, sandbox safety, source
  boundaries, and durable output contracts remain enforced.

The prompt changes implement the agent-owned strategy contract. This release
makes no claim of improved recall from them; live comparative evaluation is not
part of this release's validation evidence.

## Upgrade

Use Node 24 LTS as specified by `.nvmrc`. Back up the product data directory
before upgrading, install the new package and compatible pi peers, then restart
the control plane and each daemon. Existing projects retain their selected
provider profiles. The persisted database upgrades automatically; the release
gate exercises migration from the latest predecessor tag (`v0.3.1`).

Changed prepared source invalidates prior scope/memory reuse. Earlier artifacts
remain historical evidence, not proof of current coverage. Storage cleanup
preserves database rows but deletes selected local files; retained metadata is
not a backup of PoCs, transcripts, or source workspaces.

## Release gates

`npm run verify` runs deterministic checks, the prior-release database upgrade
contract, and the installed package contract. It does not call a live model.
Before tagging, review all workflow prompts for strategy injection and inspect
package contents for private inputs. The tag must match package metadata:
`v0.4.0` for package version `0.4.0`.

The tag workflow creates a downloadable npm tarball artifact. It does not
publish to the npm registry or create a GitHub Release automatically.
