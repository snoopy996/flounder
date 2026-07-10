# Harness Evolution Baseline

This fixture pack is a small, buildable baseline for exercising governed harness
experiments. The model-visible target names and paths do not disclose which case
is expected to produce a finding. Expected outcomes live only in the Evaluation
evidence contracts.

Create the baseline group:

```bash
flounder group create --manifest fixtures/harness-evolution/baseline.json
flounder group start harness-evolution-baseline --parallel 2
```

After implementing a bounded candidate on a separate daemon/workspace revision,
create the paired group from the same manifest with a new name:

```bash
flounder group create --manifest fixtures/harness-evolution/baseline.json --name harness-evolution-candidate
flounder group start harness-evolution-candidate --parallel 2
```

Then create and evaluate the governed experiment:

```bash
flounder experiment create \
  --name prompt-candidate-1 \
  --baseline harness-evolution-baseline \
  --candidate harness-evolution-candidate \
  --editable-file src/agent/prompts.ts
flounder experiment evaluate prompt-candidate-1
```

The fixture is deliberately too small to justify product claims by itself. A
real promotion decision should add historical blind positives, negative cases,
and project-specific controls while keeping answer-bearing materials outside the
model-visible target bundle.
