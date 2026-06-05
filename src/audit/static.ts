import type { AuditItem, AuditResult, Doc, Severity, TrialFinding } from "../types.js";

export function runStaticAuditors(items: AuditItem[], docs: Doc[] = []): AuditResult[] {
  return items.map((item) => {
    const finding = staticFindingFor(item, docs);
    return {
      item,
      nTrials: finding ? 1 : 0,
      nHits: finding ? 1 : 0,
      hitRate: finding ? 1 : 0,
      trials: finding ? [finding] : [],
    };
  });
}

function staticFindingFor(item: AuditItem, docs: Doc[]): TrialFinding | undefined {
  if (item.seeder !== "halo2_advice_binding") return undefined;
  const impact = inferBindingImpact(docs);
  return {
    finding: true,
    title: "Advice input is not visibly bound to intended source",
    severity: impact.severity,
    confidence: impact.confidence,
    description:
      "A scalar or point input is assigned into advice cells without local evidence of a copy or equality constraint binding those cells to the intended source before downstream gates rely on them." +
      impact.descriptionSuffix,
    evidence: `${item.location}: ${item.why}`,
    exploitSketch: impact.exploitSketch,
    fix: "Bind the first advice cell to the intended source with copy_advice or an explicit equality constraint, then rely on downstream internal consistency gates.",
  };
}

interface BindingImpact {
  severity: Severity;
  confidence: number;
  descriptionSuffix: string;
  exploitSketch: string;
}

function inferBindingImpact(docs: Doc[]): BindingImpact {
  const text = docs.map((doc) => doc.content).join("\n").toLowerCase();
  const hasSpendMarkerSignal = /(nullifier|spend marker|spent object|spent note|replay marker)/.test(text);
  const hasUniquenessSignal = /(unique|uniqueness|distinct|double.?spend|replay|same note|same object)/.test(text);
  const hasValueSignal = /(balance|value conservation|conservation|supply|turnstile|created|destroyed|mint|burn)/.test(text);
  const hasKeyBindingSignal = /(address|public key|viewing key|incoming key|scalar multiplication|derive public|key binding)/.test(text);

  if (hasSpendMarkerSignal && hasUniquenessSignal && hasValueSignal && hasKeyBindingSignal) {
    return {
      severity: "critical",
      confidence: 0.86,
      descriptionSuffix:
        " The loaded source or corpus also links key/address binding to spend-marker uniqueness and value conservation, so this missing binding can affect the system-level accounting invariant.",
      exploitSketch:
        "A malicious prover may choose a different private witness for the unbound scalar or point input, pass the local proof checks, and create multiple accepted spend markers for the same spent object. In a value-conserving system this can break balance integrity.",
    };
  }

  if (hasSpendMarkerSignal && hasUniquenessSignal && hasKeyBindingSignal) {
    return {
      severity: "critical",
      confidence: 0.82,
      descriptionSuffix:
        " The loaded source or corpus links the key/address binding to spend-marker uniqueness, so this missing binding can affect replay or double-spend resistance.",
      exploitSketch:
        "A malicious prover may choose a different private witness for the unbound scalar or point input and produce a distinct accepted spend marker for the same spent object.",
    };
  }

  return {
    severity: "high",
    confidence: 0.78,
    descriptionSuffix: "",
    exploitSketch:
      "A malicious prover may choose a different private witness for the unbound advice cell while satisfying gates that only relate internal cells to each other.",
  };
}
