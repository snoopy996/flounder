import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "./ledger.mjs";

test("applies an authorized transfer once", () => {
  const ledger = new Ledger([["alice", 10], ["bob", 0]]);
  ledger.transfer({ from: "alice", to: "bob", amount: 4 }, { account: "alice", action: "transfer", nonce: "n1" });
  assert.equal(ledger.balance("alice"), 6);
  assert.equal(ledger.balance("bob"), 4);
  assert.throws(() => ledger.transfer({ from: "alice", to: "bob", amount: 1 }, { account: "alice", action: "transfer", nonce: "n1" }), /replayed/);
});
