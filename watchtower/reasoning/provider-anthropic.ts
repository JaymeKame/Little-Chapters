import type { ReasoningModelResponse, ReasoningProvider, ReasoningRequest } from "./types.ts";

type AnthropicProviderOptions = { apiKey: string; baseUrl?: string; timeoutMs?: number };

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly name = "anthropic";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly options: AnthropicProviderOptions;
  constructor(options: AnthropicProviderOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async complete(request: ReasoningRequest, parentSignal: AbortSignal): Promise<ReasoningModelResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([parentSignal, timeout]);
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens, temperature: 0,
        system: request.system, messages: [{ role: "user", content: request.input }],
        tools: [{ name: "submit_judgment", description: "Submit the final Watchtower judgment without hidden reasoning", input_schema: {
          type: "object", additionalProperties: false,
          required: ["classification", "confidence", "plainEnglishExplanation", "repeatedStrategy", "genuinelyNewStrategy", "priorAttemptIds", "evidence", "unresolvedIssue", "suggestedDifferentAngle"],
          properties: {
            classification: { type: "string", enum: ["repeat", "different", "partial"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            plainEnglishExplanation: { type: "string" }, repeatedStrategy: { type: ["string", "null"] },
            genuinelyNewStrategy: { type: ["string", "null"] }, priorAttemptIds: { type: "array", items: { type: "string" } },
            evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["attemptId", "reason"], properties: { attemptId: { type: "string" }, reason: { type: "string" } } } },
            unresolvedIssue: { type: ["string", "null"] }, suggestedDifferentAngle: { type: ["string", "null"] },
          },
        } }], tool_choice: { type: "tool", name: "submit_judgment" } }),
    });
    if (!response.ok) throw new Error(`Reasoning provider returned ${response.status}`);
    const raw = await response.json() as Record<string, unknown>;
    const content = Array.isArray(raw.content) ? raw.content as Array<Record<string, unknown>> : [];
    const toolInput = content.find((block) => block.type === "tool_use" && block.name === "submit_judgment")?.input;
    const text = toolInput ? JSON.stringify(toolInput) : content.map((block) => typeof block.text === "string" ? block.text : "").join("");
    const usage = typeof raw.usage === "object" && raw.usage ? raw.usage as Record<string, unknown> : {};
    return { text, raw, usage: {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    } };
  }
}
