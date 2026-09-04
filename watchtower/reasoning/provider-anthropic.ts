import type { ProviderResponse, ReasoningProvider } from "./types.ts";

type AnthropicProviderOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
};

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly model: string;
  private readonly options: Required<Pick<AnthropicProviderOptions, "apiKey" | "baseUrl" | "maxTokens">> & AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model ?? "claude-sonnet-4-6";
    this.options = { baseUrl: "https://api.anthropic.com", maxTokens: 900, ...options };
  }

  async complete(systemPrompt: string, input: string, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await fetch(`${this.options.baseUrl}/v1/messages`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: this.options.maxTokens, temperature: 0,
        output_config: { format: { type: "json_schema", schema: JUDGMENT_JSON_SCHEMA } },
        system: systemPrompt, messages: [{ role: "user", content: input }] }),
    });
    if (!response.ok) throw new Error(`Reasoning provider returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const content = Array.isArray(body.content) ? body.content as Array<Record<string, unknown>> : [];
    const text = content.filter((block) => block.type === "text").map((block) => block.text).filter((v): v is string => typeof v === "string").join("\n");
    const usage = typeof body.usage === "object" && body.usage ? body.usage as Record<string, unknown> : {};
    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
    const estimatedCostUsd = inputTokens !== undefined && outputTokens !== undefined &&
      this.options.inputCostPerMillion !== undefined && this.options.outputCostPerMillion !== undefined
      ? (inputTokens * this.options.inputCostPerMillion + outputTokens * this.options.outputCostPerMillion) / 1_000_000 : undefined;
    let structuredResponse: unknown = text;
    try { structuredResponse = JSON.parse(text); } catch { /* Engine records the parse error and retries. */ }
    return { model: typeof body.model === "string" ? body.model : this.model, text, structuredResponse,
      usage: { inputTokens, outputTokens, estimatedCostUsd } };
  }
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const JUDGMENT_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    classification: { type: "string", enum: ["repeat", "different", "partial"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    plainEnglishExplanation: { type: "string" },
    repeatedStrategy: nullableString,
    genuinelyNewStrategy: nullableString,
    priorAttemptIds: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { attemptId: { type: "string" }, reason: { type: "string" } }, required: ["attemptId", "reason"] } },
    unresolvedIssue: nullableString,
    suggestedDifferentAngle: nullableString,
  },
  required: ["classification", "confidence", "plainEnglishExplanation", "repeatedStrategy",
    "genuinelyNewStrategy", "priorAttemptIds", "evidence", "unresolvedIssue", "suggestedDifferentAngle"],
};
