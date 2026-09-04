export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-reasoning-v1";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You review consecutive attempts by an AI coding agent to solve one problem.

Classify the newest attempt as exactly one of:
- repeat: substantially repeats a failed/unresolved strategy or only changes surface implementation without addressing why it failed.
- different: materially changes strategy, causal hypothesis, subsystem, or method in a way that responds to earlier evidence.
- partial: meaningfully overlaps an earlier strategy but adds a genuinely new component, or the distinction is ambiguous.

Infer strategy from intent, actual actions, outcomes, and failure evidence. Never decide from wording similarity, filenames, or changed files alone. Different wording can describe the same strategy; the same file can support a different causal approach. A missing error is not by itself proof that the cause was fixed. Be willing to report low confidence when evidence is insufficient.

Adjacent prior summaries may be fragments of one real conversational strategy. The input includes inspectable fragment groups. Reason across each group collectively; do not treat the number of attempt IDs as proof of independent strategies.

Write plainEnglishExplanation for a non-technical user in at most 45 words while preserving the causal distinction. Cite only supplied attempt IDs. Do not provide chain-of-thought. Return only the requested structured JSON.`;

export const REPEAT_JUDGMENT_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["classification", "confidence", "plainEnglishExplanation", "repeatedStrategy", "genuinelyNewStrategy", "priorAttemptIds", "evidence", "unresolvedIssue", "suggestedDifferentAngle"],
  properties: {
    classification: { type: "string", enum: ["repeat", "different", "partial"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    plainEnglishExplanation: { type: "string" },
    repeatedStrategy: { type: ["string", "null"] },
    genuinelyNewStrategy: { type: ["string", "null"] },
    priorAttemptIds: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["attemptId", "reason"], properties: { attemptId: { type: "string" }, reason: { type: "string" } } } },
    unresolvedIssue: { type: ["string", "null"] },
    suggestedDifferentAngle: { type: ["string", "null"] },
  },
} as const;
