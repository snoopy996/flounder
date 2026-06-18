# Reports

Vulnerability reports and incident analyses produced with `flounder`.

Each report lives in its own directory as a `README.md`. New findings are added here over time.

## Incident analysis

- [Aztec Connect $2.1M Exploit](./aztec-connect-exploit/README.md)
  — a trusted-but-unbound input (`numRealTransactions`, sitting one byte outside the hashed
  `publicInputsHash` region) in the deprecated, immutable RollupProcessorV3 let the attacker mint
  unfunded L2 deposit notes behind genuinely valid proofs and withdraw the entire pool. No
  ZK-soundness break was involved.
