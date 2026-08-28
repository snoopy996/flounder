import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MetadataStore } from "../dist/db/store.js";
import { confirmSelectorsForFinding, matchConfirmSelector, parseConfirmSelectors } from "../dist/util/confirm-selector.js";
import { findingContentKey } from "../dist/util/finding-key.js";

const technicalAdjudication = {
  gates: [
    { id: "attacker_reachability", status: "pass", evidence: "All preconditions are reachable by the untrusted caller." },
    { id: "end_to_end_effect", status: "pass", evidence: "The command observes the unauthorized end effect." },
    { id: "impact_bounds", status: "pass", evidence: "Recovery and reversibility controls do not erase the effect." },
  ],
};

// Confirm is finding-grained + resumable: pendingConfirmable lists audit-confirmed findings with no
// real-target decision yet; a confirm_decision whose members are finding content keys flips those
// findings' confirm_status; and a later pendingConfirmable skips the decided ones.
test("pendingConfirmable + decision -> confirm_status (finding-grained, resumable)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fl-confirm-"));
  const dbPath = path.join(dir, "t.db");
  const store = new MetadataStore(dbPath);
  const pid = store.upsertProject({ name: "p", sourcePaths: ["/x"], config: {} });
  const runId = store.startRun({ projectId: pid, kind: "run", runDir: "/runs/r1" });

  const keyA = findingContentKey("S1", "Vault.sol:10", "Bug A");
  const keyB = findingContentKey("S2", "Vault.sol:20", "Bug B");
  store.upsertFindings(pid, runId, [
    { findingKey: keyA, title: "Bug A", location: "Vault.sol:10", severity: "high", status: "confirmed-differential", scopeId: "S1" },
    { findingKey: keyB, title: "Bug B", location: "Vault.sol:20", severity: "medium", status: "confirmed-executable", scopeId: "S2" },
    { findingKey: findingContentKey("S3", "x", "C"), title: "C", location: "x", status: "suspected", scopeId: "S3" }, // not confirmable
  ]);

  let pending = store.pendingConfirmable(pid);
  assert.deepEqual(pending.map((p) => p.finding_key).sort(), [keyA, keyB].sort(), "both confirmed findings are pending; suspected is excluded");
  assert.equal(pending[0].run_dir, "/runs/r1", "pending carries the source run dir");

  // a confirm settles A=reproduced, B=not. Models sometimes include the title next to the
  // content key, so the store accepts both exact keys and "key title" members.
  store.upsertConfirmDecisions(pid, runId, [
    { bug: "Bug A", reproduced: "yes", evidenceLevel: "real-target-reproduced", reproCommandId: "cmd-a", adjudication: technicalAdjudication, members: [`${keyA} Bug A`] },
    { bug: "Bug B", reproduced: "no", members: [`[${keyB}] Bug B`] },
  ]);

  const byKey = Object.fromEntries(store.listFindings(pid).map((f) => [f.finding_key, f.confirm_status]));
  assert.equal(byKey[keyA], "reproduced");
  assert.equal(byKey[keyB], "not-reproduced");

  pending = store.pendingConfirmable(pid);
  assert.equal(pending.length, 0, "resume: both decided, nothing left pending");

  store.db.prepare("UPDATE finding SET confirm_status = NULL").run();
  store.close();

  const reopened = new MetadataStore(dbPath);
  const repaired = Object.fromEntries(reopened.listFindings(pid).map((f) => [f.finding_key, f.confirm_status]));
  assert.equal(repaired[keyA], "reproduced", "opening an older DB backfills exact or noisy confirm members");
  assert.equal(repaired[keyB], "not-reproduced");
  reopened.close();
});

test("opening an older database reopens mechanism-only reproductions without disturbing attacker-real decisions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fl-confirm-validity-migration-"));
  const dbPath = path.join(dir, "t.db");
  const store = new MetadataStore(dbPath);
  const pid = store.upsertProject({ name: "p", sourcePaths: ["/x"], config: {} });
  const runId = store.startRun({ projectId: pid, kind: "confirm", runDir: "/runs/confirm" });
  const conditionalKey = findingContentKey("S1", "Adapter.sol:10", "Conditional mechanism");
  const reachableKey = findingContentKey("S2", "Adapter.sol:20", "Reachable exploit");
  store.upsertFindings(pid, runId, [
    { findingKey: conditionalKey, title: "Conditional mechanism", location: "Adapter.sol:10", severity: "high", status: "confirmed-executable", scopeId: "S1" },
    { findingKey: reachableKey, title: "Reachable exploit", location: "Adapter.sol:20", severity: "high", status: "confirmed-executable", scopeId: "S2" },
  ]);
  store.upsertConfirmDecisions(pid, runId, [
    {
      bug: "Conditional mechanism",
      members: [conditionalKey],
      reproduced: "yes",
      evidenceLevel: "local-fork-reproduced",
      reproCommandId: "cmd-conditional",
      adjudication: {
        gates: [
          { id: "attacker_reachability", status: "fail", evidence: "The test required a role that the assessed attacker does not control." },
          { id: "end_to_end_effect", status: "pass", evidence: "The role-modified fork exhibited the conditional effect." },
          { id: "impact_bounds", status: "pass", evidence: "The conditional effect persisted in the modified state." },
        ],
      },
    },
    {
      bug: "Reachable exploit",
      members: [reachableKey],
      reproduced: "yes",
      evidenceLevel: "local-fork-reproduced",
      reproCommandId: "cmd-reachable",
      adjudication: technicalAdjudication,
    },
  ]);

  // Simulate the persisted flag written by a pre-migration product version.
  store.db.prepare("UPDATE finding SET confirm_status = 'reproduced'").run();
  store.close();

  const reopened = new MetadataStore(dbPath);
  const statuses = Object.fromEntries(reopened.listFindings(pid).map((finding) => [finding.finding_key, finding.confirm_status]));
  assert.equal(statuses[conditionalKey], null, "conditional evidence is reopened for automatic confirmation work");
  assert.equal(statuses[reachableKey], "reproduced", "a fully attacker-real reproduction remains settled");
  reopened.close();
});

test("getConfirmable is project-scoped and only returns pending audit-confirmed findings", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fl-confirm-one-"));
  const store = new MetadataStore(path.join(dir, "t.db"));
  const pid = store.upsertProject({ name: "p" });
  const otherPid = store.upsertProject({ name: "other" });
  const runId = store.startRun({ projectId: pid, kind: "run", runDir: "/runs/p-1" });
  const otherRunId = store.startRun({ projectId: otherPid, kind: "run", runDir: "/runs/o-1" });

  const confirmedKey = findingContentKey("S1", "x:1", "confirmed");
  const suspectedKey = findingContentKey("S2", "x:2", "suspected");
  const settledKey = findingContentKey("S3", "x:3", "settled");
  store.upsertFindings(pid, runId, [
    { findingKey: confirmedKey, title: "confirmed", location: "x:1", status: "confirmed-executable", scopeId: "S1" },
    { findingKey: suspectedKey, title: "suspected", location: "x:2", status: "suspected", scopeId: "S2" },
    { findingKey: settledKey, title: "settled", location: "x:3", status: "confirmed-differential", scopeId: "S3" },
  ]);
  store.upsertFindings(otherPid, otherRunId, [{ findingKey: "other", title: "other", location: "o:1", status: "confirmed-executable" }]);
  store.setFindingConfirmStatus(pid, settledKey, "reproduced");

  const rows = Object.fromEntries(store.listFindings(pid).map((f) => [f.finding_key, f.id]));
  const other = store.listFindings(otherPid)[0];

  assert.equal(store.getConfirmable(pid, Number(rows[confirmedKey]))?.finding_key, confirmedKey);
  assert.equal(store.getConfirmable(pid, Number(rows[suspectedKey])), undefined);
  assert.equal(store.getConfirmable(pid, Number(rows[settledKey])), undefined);
  assert.equal(store.getConfirmable(pid, Number(other.id)), undefined, "finding ids are scoped to the project");
  store.close();
});

test("confirm selectors can address verify artifacts by originId while preserving DB key members", () => {
  const selectors = confirmSelectorsForFinding({ id: 42, finding_key: "kdb" });
  assert.deepEqual(selectors, ["kdb", "origin:42:kdb"]);

  const parsed = parseConfirmSelectors(selectors);
  assert.equal(matchConfirmSelector(parsed, "kartifact", 42), "kdb");
  assert.equal(matchConfirmSelector(parsed, "kdb", undefined), "kdb");
  assert.equal(matchConfirmSelector(parsed, "kartifact", 43), undefined);
});
