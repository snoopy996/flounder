FROM flounder-sandbox:latest

ARG TON_BLUEPRINT_VERSION=0.45.0
ARG TON_CORE_VERSION=0.63.1
ARG TON_SANDBOX_VERSION=0.44.0
ARG TON_FUNC_JS_VERSION=0.11.0
ARG TON_CRYPTO_VERSION=3.3.0
ARG TON_VERSION=16.3.0
ARG TON_TOLK_JS_VERSION=1.4.2
ARG TACT_COMPILER_VERSION=1.6.13

RUN npm install -g \
    "@ton/blueprint@${TON_BLUEPRINT_VERSION}" \
    "@ton/core@${TON_CORE_VERSION}" \
    "@ton/sandbox@${TON_SANDBOX_VERSION}" \
    "@ton-community/func-js@${TON_FUNC_JS_VERSION}" \
    "@ton/crypto@${TON_CRYPTO_VERSION}" \
    "@ton/ton@${TON_VERSION}" \
    "@ton/tolk-js@${TON_TOLK_JS_VERSION}" \
    "@tact-lang/compiler@${TACT_COMPILER_VERSION}" \
  && blueprint help \
  && func-js --help \
  && tolk-js --help \
  && tact --help

WORKDIR /workspace
