#!/usr/bin/env node
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig, runPipeline } from "../dist/index.js";

const source = readFlag(process.argv.slice(2), "--source") ?? process.env.FSA_DISCOVERY_SOURCE;
if (!source) {
  throw new Error("Provide --source <path> or set FSA_DISCOVERY_SOURCE.");
}
const corpusPaths = readMultiFlag(process.argv.slice(2), "--corpus");
const expectSeverity = readFlag(process.argv.slice(2), "--expect-severity") ?? "high";

const out = await mkdtemp(path.join(os.tmpdir(), "fsa-source-discovery-"));
const cfg = defaultConfig();
cfg.targetName = "source-discovery";
cfg.sourcePaths = [source];
cfg.corpusPaths = corpusPaths;
cfg.outputDir = out;
cfg.dryRun = true;

const result = await runPipeline(cfg);
const summary = JSON.parse(await readFile(path.join(result.runDir, "summary.json"), "utf8"));
const findings = Array.isArray(summary.findings) ? summary.findings : [];
const bindingFinding = findings.find(
  (finding) => finding.failureMode === "missing_constraint" && /Advice input is not visibly bound/.test(finding.title),
);

if (!bindingFinding) {
  throw new Error("No high-confidence scalar/point advice-binding finding was discovered.");
}
if (bindingFinding.severity !== expectSeverity) {
  throw new Error(`Expected ${expectSeverity} severity for binding finding, got ${bindingFinding.severity}.`);
}

console.log(`Source discovery check passed: ${bindingFinding.severity} ${bindingFinding.location}`);

function readFlag(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function readMultiFlag(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return [];
  const out = [];
  for (let i = idx + 1; i < args.length; i += 1) {
    const value = args[i];
    if (!value || value.startsWith("--")) break;
    out.push(value);
  }
  return out;
}
