import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

async function loadDomainModule() {
  const source = readFileSync(new URL("../src/server/ui/src/domain.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "domain.ts",
    reportDiagnostics: true,
  });
  const diagnostics = compiled.diagnostics?.filter((entry) => entry.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(diagnostics, []);
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
}

const { projectSourceState } = await loadDomainModule();

test("ui: source setup is ready when configured source paths exist", () => {
  assert.deepEqual(projectSourceState(null, ["src"]), { kind: "configured", ok: true });
});

test("ui: source setup is ready when prepare produced an audit-ready workspace", () => {
  const detail = {
    prepareSummary: {
      quality: "ready",
      auditReady: true,
      workspace: { exists: true },
    },
  };
  assert.deepEqual(projectSourceState(detail, []), { kind: "prepared", ok: true });
});

test("ui: source setup stays missing when prepared workspace is unavailable or not audit-ready", () => {
  assert.deepEqual(projectSourceState({ prepareSummary: { quality: "ready", auditReady: true, workspace: { exists: false } } }, []), { kind: "missing", ok: false });
  assert.deepEqual(projectSourceState({ prepareSummary: { quality: "preparing", auditReady: false, workspace: { exists: true } } }, []), { kind: "missing", ok: false });
});
