import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REFUTE_SYSTEM } from "../dist/agent/refutation.js";

test("independent refutation investigates privileged control instead of applying a role-name rule", () => {
  assert.match(REFUTE_SYSTEM, /Do NOT mechanically refute or accept a PoC merely because it uses a privileged role/);
  assert.match(REFUTE_SYSTEM, /who controls the role, its actual control model/);
  assert.match(REFUTE_SYSTEM, /Reputation or a brand name alone is not evidence/);
  assert.match(REFUTE_SYSTEM, /Preserve any conditional mechanism/);
});

test("an appeal may establish a realistic control path instead of blindly removing the role", () => {
  const auditSource = readFileSync(new URL("../src/agent/audit.ts", import.meta.url), "utf8");
  assert.match(auditSource, /do not blindly remove a disputed role/);
  assert.match(auditSource, /either trigger the effect without the disputed capability, or demonstrate why that capability is legitimately within the assessed attacker model/);
  assert.match(auditSource, /Distinguish present exploitability from a conditional mechanism and its impact ceiling/);
});
