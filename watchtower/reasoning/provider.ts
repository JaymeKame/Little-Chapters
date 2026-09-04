import type { ReasoningProvider, ReasoningProviderResponse } from "./types.ts";

type AnthropicResponse = {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export class AnthropicReasoningProvider implements ReasoningProvider {
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly endpoint: string;
  constructor(
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = process.env.WATCHTOWER_REASONING_MODEL,
    endpoint = process.env.WATCHTOWER_REASONING_ENDPOINT ?? "https://api.anthropic.com/v1/messages",
  ) { this.apiKey = apiKey; this.model = model; this.endpoint = endpoint; }

  async complete(request: { system: string; input: string; timeoutMs: number }): Promise<ReasoningProviderResponse> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    if (!this.model) throw new Error("WATCHTOWER_REASONING_MODEL is not configured");
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 700, temperature: 0, system: request.system,
        messages: [{ role: "user", content: request.input }] }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const body = await response.json() as AnthropicResponse;
    if (!response.ok) throw new Error(`Reasoning provider returned ${response.status}: ${body.error?.message ?? "unknown error"}`);
    const text = body.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") ?? "";
    return { model: body.model ?? this.model, text,
      usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
  }
}
