import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("default sandbox image includes baseline source-inspection tools", async () => {
  const dockerfile = await readFile(new URL("../docker/flounder-sandbox.Dockerfile", import.meta.url), "utf8");
  for (const pkg of ["bash", "cmake", "findutils", "grep", "jq", "git", "ninja-build", "ripgrep", "sed"]) {
    assert.match(dockerfile, new RegExp(`\\b${pkg}\\b`), `sandbox image should install ${pkg}`);
  }
});

test("default sandbox image includes Python headers for native dependencies", async () => {
  const dockerfile = await readFile(new URL("../docker/flounder-sandbox.Dockerfile", import.meta.url), "utf8");
  for (const pkg of ["python3", "python3-dev", "python3-pip", "python3-venv"]) {
    assert.match(dockerfile, new RegExp(`\\b${pkg}\\b`), `sandbox image should install ${pkg}`);
  }
});

test("foundry tools are copied into the non-root sandbox PATH", async () => {
  const dockerfile = await readFile(new URL("../docker/flounder-sandbox.Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /install -m 0755 "\$\{FOUNDRY_DIR\}\/bin\/forge" \/usr\/local\/bin\/forge/);
  assert.doesNotMatch(dockerfile, /ln -sf "\$\{FOUNDRY_DIR\}\/bin\/forge" \/usr\/local\/bin\/forge/);
});

test("default sandbox image includes common JavaScript package managers", async () => {
  const dockerfile = await readFile(new URL("../docker/flounder-sandbox.Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /npm install -g yarn@1\.22\.22 pnpm@9\.15\.9/);
  assert.match(dockerfile, /yarn --version/);
  assert.match(dockerfile, /pnpm --version/);
});

test("Cairo sandbox image pins Scarb, Starknet Foundry, and Sierra compiler", async () => {
  const dockerfile = await readFile(new URL("../docker/flounder-sandbox-cairo.Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM flounder-sandbox:latest/);
  assert.match(dockerfile, /ARG SCARB_VERSION=2\.19\.0/);
  assert.match(dockerfile, /ARG STARKNET_FOUNDRY_VERSION=0\.62\.0/);
  assert.match(dockerfile, /ARG UNIVERSAL_SIERRA_COMPILER_VERSION=2\.9\.0/);
  assert.match(dockerfile, /ARG SOLCJS_VERSION=0\.8\.20/);
  assert.match(dockerfile, /ENV FOUNDRY_SOLC=\/usr\/local\/bin\/solc/);
  assert.match(dockerfile, /scarb-checksums\.sha256/);
  assert.match(dockerfile, /grep "\[ \*\]\$\{scarb_archive\}\$"/);
  assert.match(dockerfile, /universal-sierra-compiler\/releases\/download/);
  assert.match(dockerfile, /install -m 0755 \/tmp\/universal-sierra-compiler\/bin\/universal-sierra-compiler \/usr\/local\/bin\/universal-sierra-compiler/);
  assert.match(dockerfile, /npm install -g "solc@\$\{SOLCJS_VERSION\}"/);
  assert.match(dockerfile, /--allow-paths\) skip_next=1/);
  assert.match(dockerfile, /--standard-json\) standard_json=1/);
  assert.match(dockerfile, /solcjs "\$\{args\[@\]\}"/);
  assert.match(dockerfile, /prefix="\$\{line%%\\\{\*\}"/);
  assert.match(dockerfile, /snforge --version/);
  assert.match(dockerfile, /sncast --version/);
  assert.match(dockerfile, /universal-sierra-compiler --version/);
  assert.match(dockerfile, /solc --version/);
  assert.match(dockerfile, /forge build/);
});

test("TON sandbox image pins Blueprint and in-process test dependencies", async () => {
  const dockerfile = await readFile(new URL("../docker/flounder-sandbox-ton.Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM flounder-sandbox:latest/);
  assert.match(dockerfile, /ARG TON_BLUEPRINT_VERSION=0\.45\.0/);
  assert.match(dockerfile, /ARG TON_SANDBOX_VERSION=0\.44\.0/);
  assert.match(dockerfile, /ARG TON_FUNC_JS_VERSION=0\.11\.0/);
  assert.match(dockerfile, /ARG TON_TOLK_JS_VERSION=1\.4\.2/);
  assert.match(dockerfile, /ARG TACT_COMPILER_VERSION=1\.6\.13/);
  assert.match(dockerfile, /@ton\/blueprint@\$\{TON_BLUEPRINT_VERSION\}/);
  assert.match(dockerfile, /@ton-community\/func-js@\$\{TON_FUNC_JS_VERSION\}/);
  assert.match(dockerfile, /@ton\/tolk-js@\$\{TON_TOLK_JS_VERSION\}/);
  assert.match(dockerfile, /@tact-lang\/compiler@\$\{TACT_COMPILER_VERSION\}/);
});
