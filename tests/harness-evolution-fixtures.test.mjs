import assert from "node:assert/strict";
import test from "node:test";
import { Ledger as CaseA } from "../fixtures/harness-evolution/case-a/ledger.mjs";
import { Ledger as CaseB } from "../fixtures/harness-evolution/case-b/ledger.mjs";

function attackerTransfer(Ledger) {
  const ledger = new Ledger([["victim", 10], ["attacker", 0]]);
  ledger.transfer(
    { from: "victim", to: "attacker", amount: 7 },
    { account: "attacker", action: "transfer", nonce: "attacker-nonce" },
  );
  return ledger;
}

test("harness fixture oracle: case A admits the attacker transfer", () => {
  const ledger = attackerTransfer(CaseA);
  assert.equal(ledger.balance("victim"), 3);
  assert.equal(ledger.balance("attacker"), 7);
});

test("harness fixture oracle: case B rejects the same attacker capability", () => {
  assert.throws(() => attackerTransfer(CaseB), /wrong account/);
});
