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
    this.model = options.model ?? "claude-sonnet-4-5-20250929";
    this.options = { baseUrl: "https://api.anthropic.com", maxTokens: 900, ...options };
  }

  async complete(systemPrompt: string, input: string, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await fetch(`${this.options.baseUrl}/v1/messages`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: this.options.maxTokens, temperature: 0,
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
    return { model: typeof body.model === "string" ? body.model : this.model, text, structuredResponse: body,
      usage: { inputTokens, outputTokens, estimatedCostUsd } };
  }
}
