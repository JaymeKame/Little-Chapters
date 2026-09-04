import type { ReasoningPromptInput, ReasoningProvider, ReasoningProviderResponse } from "./schema.ts";
import { buildReasoningInput } from "./prompt.ts";

const INPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    classification: { type: "string", enum: ["repeat", "different", "partial"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    plainEnglishExplanation: { type: "string" },
    repeatedStrategy: { type: ["string", "null"] }, genuinelyNewStrategy: { type: ["string", "null"] },
    priorAttemptIds: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { attemptId: { type: "string" }, reason: { type: "string" } }, required: ["attemptId", "reason"] } },
    unresolvedIssue: { type: ["string", "null"] }, suggestedDifferentAngle: { type: ["string", "null"] },
  }, required: ["classification", "confidence", "plainEnglishExplanation", "repeatedStrategy", "genuinelyNewStrategy",
    "priorAttemptIds", "evidence", "unresolvedIssue", "suggestedDifferentAngle"]
};

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly model: string;
  private readonly apiKey: string | undefined;
  constructor(model = process.env.WATCHTOWER_REASONING_MODEL ?? "claude-haiku-4-5-20251001",
    apiKey = process.env.ANTHROPIC_API_KEY) { this.model = model; this.apiKey = apiKey; }

  async judge(systemPrompt: string, input: ReasoningPromptInput, signal: AbortSignal): Promise<ReasoningProviderResponse> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 800, temperature: 0, system: systemPrompt,
        messages: [{ role: "user", content: buildReasoningInput(input) }],
        tools: [{ name: "submit_repeat_judgment", description: "Submit the final structured Watchtower judgment", input_schema: INPUT_SCHEMA }],
        tool_choice: { type: "tool", name: "submit_repeat_judgment" } }) });
    const raw = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${JSON.stringify(raw).slice(0, 500)}`);
    const blocks = Array.isArray(raw.content) ? raw.content as Array<Record<string, unknown>> : [];
    const structuredResponse = blocks.find((block) => block.type === "tool_use" && block.name === "submit_repeat_judgment")?.input;
    if (!structuredResponse) throw new Error("Model did not return submit_repeat_judgment");
    const usage = typeof raw.usage === "object" && raw.usage ? raw.usage as Record<string, unknown> : {};
    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
    const inputRate = Number(process.env.WATCHTOWER_INPUT_COST_PER_MTOK);
    const outputRate = Number(process.env.WATCHTOWER_OUTPUT_COST_PER_MTOK);
    const estimatedCostUsd = Number.isFinite(inputRate) && Number.isFinite(outputRate) && inputTokens !== undefined && outputTokens !== undefined
      ? (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000 : undefined;
    return { model: this.model, rawResponse: raw, structuredResponse, usage: { inputTokens, outputTokens }, estimatedCostUsd };
  }
}
