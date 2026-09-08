#!/usr/bin/env node
// Validate the shipped artifact, not the source checkout. No registry or model calls.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "flounder-package-"));
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
try {
  const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
  if (tag) assert.equal(tag, `v${manifest.version}`, "release tag must match package version");
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run this check through npm run check:package:dist");
  const { stdout } = await exec(process.execPath, [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", temp], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const [packed] = JSON.parse(stdout);
  const files = new Set(packed.files.map((file) => file.path));
  assert.equal(packed.version, manifest.version);
  for (const file of files) {
    assert.ok(!/(^|\/)(node_modules|runs|files|\.git|\.env|auth\.json)(\/|$)/.test(file), `private artifact in package: ${file}`);
    if (!file.startsWith("dist/") || !file.endsWith(".js")) continue;
    const source = ts.createSourceFile(file, await readFile(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.text));
        assert.ok(files.has(target), `${file} imports missing packaged module ${target}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const file of ["dist/index.d.ts", "dist/pi/extension.d.ts", "dist/server/public/index.html", "skills/flounder/SKILL.md", "LICENSE", "SECURITY.md"]) {
    assert.ok(files.has(file), `missing public entrypoint or asset: ${file}`);
  }
  await exec("tar", ["-xzf", path.join(temp, packed.filename), "-C", temp]);
  const installed = path.join(temp, "package");
  // Reuse the locked dependencies, but resolve every product module from the tarball.
  await symlink(path.join(root, "node_modules"), path.join(installed, "node_modules"), "dir");
  for (const args of [["dist/cli.js", "--help"], ["dist/cli.js", "storage", "--help"], ["--input-type=module", "-e", "await import('flounders'); await import('flounders/pi/extension');"]]) {
    await exec(process.execPath, args, { cwd: installed, timeout: 30_000, maxBuffer: 1024 * 1024 });
  }
  await exec(process.execPath, [path.join(installed, "scripts/mock-audit.mjs")], { cwd: temp, timeout: 60_000, maxBuffer: 1024 * 1024 });
  await exec(process.execPath, [path.join(installed, "scripts/check-public-surface.mjs"), "--current-only"], { cwd: installed, timeout: 30_000, maxBuffer: 1024 * 1024 });
  console.log(`Package contract passed (${manifest.version}; ${files.size} files; CLI, exports, UI assets, mock audit, public surface).`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
