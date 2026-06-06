import type { AuditorConfig } from "../config.js";
import { buildVerifyPrompt, VERIFY_SYSTEM } from "../agents/prompts.js";
import { SourceIndex } from "../index/source-index.js";
import { renderProjectLearning } from "../learn/project.js";
import type { Doc, LlmClient, ProjectLearning, RankedFinding, Verification, VerificationVerdict } from "../types.js";
import type { RunLogger } from "../trace/logger.js";

export async function verifyTop(input: {
  cfg: AuditorConfig;
  findings: RankedFinding[];
  source: Doc[];
  projectLearning?: ProjectLearning;
  llm?: LlmClient;
  logger: RunLogger;
  topK: number;
}): Promise<Verification[]> {
  if (input.cfg.dryRun || !input.llm) {
    const out = input.findings.slice(0, input.topK).map((finding) => ({
      id: finding.id,
      verdict: "needs-investigation" as const,
      confirmationStatus: "suspected" as const,
      markdown: `VERDICT: needs-investigation\n\nDry-run mode skipped model verification for ${finding.title}.`,
    }));
    await input.logger.artifact("verifications.json", out);
    return out;
  }
  const index = new SourceIndex(input.source);
  const out: Verification[] = [];
  for (const finding of input.findings.slice(0, input.topK)) {
    const sourceText = index.contextForItem(
      {
        id: finding.id,
        location: finding.location,
        securityProperty: finding.description,
        failureMode: finding.failureMode,
        why: finding.evidence,
      },
      input.cfg.contextCharBudget,
    );
    const user = buildVerifyPrompt({
      title: finding.title,
      location: finding.location,
      severity: finding.severity,
      description: finding.description,
      evidence: finding.evidence,
      fix: finding.fix,
      projectLearning: renderProjectLearning(input.projectLearning),
      source: sourceText,
    });
    const markdown = await input.llm.complete({
      tag: `verify_${finding.id}`,
      system: VERIFY_SYSTEM,
      user,
      model: input.cfg.verifyModel,
      maxTokens: input.cfg.maxTokens,
      thinkingLevel: input.cfg.thinkingLevel,
    });
    const verdict = parseVerificationVerdict(markdown);
    out.push({ id: finding.id, verdict, confirmationStatus: verdict === "confirmed" ? "confirmed-source" : "suspected", markdown });
  }
  await input.logger.artifact("verifications.json", out);
  return out;
}

export function parseVerificationVerdict(markdown: string): VerificationVerdict {
  const verdictLine = markdown
    .split(/\r?\n/)
    .find((line) => /\bverdict\b/i.test(line))
    ?.toLowerCase();
  const text = (verdictLine ?? markdown.slice(0, 500)).toLowerCase();
  if (/false[\s-]?positive|refuted|not\s+a\s+bug/.test(text)) return "false-positive";
  if (/\bconfirmed(?:[\s-]?source)?\b/.test(text)) return "confirmed";
  return "needs-investigation";
}
