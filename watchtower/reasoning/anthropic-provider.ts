import type { ProviderResponse, ReasoningProvider } from "./types.ts";

type AnthropicResponse = { model?: string; content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  constructor(apiKey: string, model = "claude-haiku-4-5", timeoutMs = 15_000) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async complete(systemPrompt: string, input: unknown, outerSignal: AbortSignal): Promise<ProviderResponse> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([outerSignal, timeout]);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 700, temperature: 0,
        system: systemPrompt, messages: [{ role: "user", content: JSON.stringify(input) }] }),
    });
    const body = await response.json() as AnthropicResponse;
    if (!response.ok) throw new Error(`Reasoning provider HTTP ${response.status}: ${body.error?.message ?? "unknown error"}`);
    const text = body.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
    return { model: body.model ?? this.model, text,
      tokenUsage: body.usage ? { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 } : undefined };
  }
}
