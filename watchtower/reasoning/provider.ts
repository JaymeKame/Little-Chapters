import type { ModelResponse, ReasoningProvider } from "./types.ts";

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  constructor(model: string, apiKey: string) { this.model = model; this.apiKey = apiKey; }

  async complete(system: string, input: string, signal: AbortSignal): Promise<ModelResponse> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 700, temperature: 0,
        system, messages: [{ role: "user", content: input }] }),
    });
    const raw = await response.json() as AnthropicResponse;
    if (!response.ok) throw new Error(`Anthropic ${response.status}: ${raw.error?.message ?? "request failed"}`);
    const text = raw.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n") ?? "";
    return { text, raw, usage: { inputTokens: raw.usage?.input_tokens, outputTokens: raw.usage?.output_tokens } };
  }
}
