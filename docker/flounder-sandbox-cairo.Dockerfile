FROM flounder-sandbox:latest

ARG SCARB_VERSION=2.19.0
ARG STARKNET_FOUNDRY_VERSION=0.62.0
ARG STARKNET_FOUNDRY_X86_64_SHA256=156a56b5d11c0d4ebc645537e2140d7a39022759663c0b981ffeb90a0ced1804
ARG STARKNET_FOUNDRY_AARCH64_SHA256=7f5def2014b83a4147949cc1870e88f09d617e52e187cf7a80980fd3bff09ab0
ARG UNIVERSAL_SIERRA_COMPILER_VERSION=2.9.0
ARG UNIVERSAL_SIERRA_COMPILER_X86_64_SHA256=c51bdb3fd5a544085c0b635de2431687f1decb224ff41a87be52f6afc518ab8a
ARG UNIVERSAL_SIERRA_COMPILER_AARCH64_SHA256=845d981b7d13d8cea90110b07fec2b5212ffdb25ecee0a1c634e09689b5767b0
ARG SOLCJS_VERSION=0.8.20
ARG TARGETARCH

ENV FOUNDRY_SOLC=/usr/local/bin/solc

RUN set -eux; \
  case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
    amd64|x86_64) release_arch="x86_64"; sn_sha="${STARKNET_FOUNDRY_X86_64_SHA256}"; usc_sha="${UNIVERSAL_SIERRA_COMPILER_X86_64_SHA256}" ;; \
    arm64|aarch64) release_arch="aarch64"; sn_sha="${STARKNET_FOUNDRY_AARCH64_SHA256}"; usc_sha="${UNIVERSAL_SIERRA_COMPILER_AARCH64_SHA256}" ;; \
    *) echo "unsupported target arch: ${TARGETARCH:-$(dpkg --print-architecture)}" >&2; exit 1 ;; \
  esac; \
  scarb_archive="scarb-v${SCARB_VERSION}-${release_arch}-unknown-linux-gnu.tar.gz"; \
  curl -fsSLo "/tmp/${scarb_archive}" "https://github.com/software-mansion/scarb/releases/download/v${SCARB_VERSION}/${scarb_archive}"; \
  curl -fsSLo /tmp/scarb-checksums.sha256 "https://github.com/software-mansion/scarb/releases/download/v${SCARB_VERSION}/checksums.sha256"; \
  (cd /tmp && grep "[ *]${scarb_archive}$" scarb-checksums.sha256 | sha256sum -c -); \
  mkdir -p /tmp/scarb; \
  tar -xzf "/tmp/${scarb_archive}" -C /tmp/scarb --strip-components=1; \
  install -m 0755 /tmp/scarb/bin/scarb /usr/local/bin/scarb; \
  sn_archive="starknet-foundry-v${STARKNET_FOUNDRY_VERSION}-${release_arch}-unknown-linux-gnu.tar.gz"; \
  curl -fsSLo "/tmp/${sn_archive}" "https://github.com/foundry-rs/starknet-foundry/releases/download/v${STARKNET_FOUNDRY_VERSION}/${sn_archive}"; \
  echo "${sn_sha}  /tmp/${sn_archive}" | sha256sum -c -; \
  mkdir -p /tmp/starknet-foundry; \
  tar -xzf "/tmp/${sn_archive}" -C /tmp/starknet-foundry --strip-components=1; \
  find /tmp/starknet-foundry -type f -name snforge -exec install -m 0755 {} /usr/local/bin/snforge \; -quit; \
  find /tmp/starknet-foundry -type f -name sncast -exec install -m 0755 {} /usr/local/bin/sncast \; -quit; \
  usc_archive="universal-sierra-compiler-v${UNIVERSAL_SIERRA_COMPILER_VERSION}-${release_arch}-unknown-linux-gnu.tar.gz"; \
  curl -fsSLo "/tmp/${usc_archive}" "https://github.com/software-mansion/universal-sierra-compiler/releases/download/v${UNIVERSAL_SIERRA_COMPILER_VERSION}/${usc_archive}"; \
  echo "${usc_sha}  /tmp/${usc_archive}" | sha256sum -c -; \
  mkdir -p /tmp/universal-sierra-compiler; \
  tar -xzf "/tmp/${usc_archive}" -C /tmp/universal-sierra-compiler --strip-components=1; \
  install -m 0755 /tmp/universal-sierra-compiler/bin/universal-sierra-compiler /usr/local/bin/universal-sierra-compiler; \
  scarb --version; \
  snforge --version; \
  sncast --version; \
  universal-sierra-compiler --version; \
  rm -rf /tmp/scarb /tmp/starknet-foundry /tmp/universal-sierra-compiler "/tmp/${scarb_archive}" "/tmp/${sn_archive}" "/tmp/${usc_archive}" /tmp/scarb-checksums.sha256

RUN set -eux; \
  npm install -g "solc@${SOLCJS_VERSION}"; \
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'args=()' \
    'skip_next=0' \
    'standard_json=0' \
    'for arg in "$@"; do' \
    '  if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi' \
    '  case "$arg" in' \
    '    --allow-paths) skip_next=1 ;;' \
    '    --allow-paths=*) ;;' \
    '    --standard-json) standard_json=1; args+=("$arg") ;;' \
    '    *) args+=("$arg") ;;' \
    '  esac' \
    'done' \
    'out_file="$(mktemp)"' \
    'err_file="$(mktemp)"' \
    'set +e' \
    'solcjs "${args[@]}" > "$out_file" 2> "$err_file"' \
    'status=$?' \
    'set -e' \
    'cat "$err_file" >&2' \
    'if [ "$standard_json" = 1 ]; then' \
    '  started=0' \
    '  while IFS= read -r line; do' \
    '    if [ "$started" = 0 ]; then' \
    '      if [[ "$line" == *"{"* ]]; then' \
    '        prefix="${line%%\{*}"' \
    '        printf "%s\n" "${line:${#prefix}}"' \
    '        started=1' \
    '      fi' \
    '    else' \
    '      printf "%s\n" "$line"' \
    '    fi' \
    '  done < "$out_file"' \
    'else' \
    '  cat "$out_file"' \
    'fi' \
    'rm -f "$out_file" "$err_file"' \
    'exit "$status"' \
    > /usr/local/bin/solc; \
  chmod 0755 /usr/local/bin/solc; \
  solc --version; \
  mkdir -p /tmp/forge-smoke/src; \
  printf '%s\n' \
    '// SPDX-License-Identifier: MIT' \
    'pragma solidity ^0.8.20;' \
    'contract Smoke { function ok() external pure returns (uint256) { return 1; } }' \
    > /tmp/forge-smoke/src/Smoke.sol; \
  printf '%s\n' \
    '[profile.default]' \
    'src = "src"' \
    'out = "out"' \
    > /tmp/forge-smoke/foundry.toml; \
  (cd /tmp/forge-smoke && forge build); \
  rm -rf /tmp/forge-smoke

WORKDIR /workspace
