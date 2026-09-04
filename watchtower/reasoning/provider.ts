import { REPEAT_JUDGMENT_JSON_SCHEMA } from "./prompt.ts";
import type { ReasoningProvider, ReasoningProviderResponse } from "./types.ts";

type OpenAIProviderOptions = { apiKey: string; model?: string; baseUrl?: string };

export class OpenAIResponsesReasoningProvider implements ReasoningProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-5-mini";
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async reason(instructions: string, input: string, signal: AbortSignal): Promise<ReasoningProviderResponse> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST", signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, instructions, input,
        text: { format: { type: "json_schema", name: "watchtower_repeat_judgment", strict: true,
          schema: REPEAT_JUDGMENT_JSON_SCHEMA } } }),
    });
    if (!response.ok) throw new Error(`Reasoning provider returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const outputText = typeof body.output_text === "string" ? body.output_text : extractOutputText(body.output);
    if (!outputText) throw new Error("Reasoning provider response contained no structured output text");
    const usage = asObject(body.usage);
    return { model: typeof body.model === "string" ? body.model : this.model, structuredResponse: JSON.parse(outputText),
      tokenUsage: { inputTokens: number(usage.input_tokens), outputTokens: number(usage.output_tokens), totalTokens: number(usage.total_tokens) } };
  }
}

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const number = (value: unknown): number | undefined => typeof value === "number" ? value : undefined;
function extractOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) for (const content of Array.isArray(asObject(item).content) ? asObject(item).content as unknown[] : []) {
    const text = asObject(content).text; if (typeof text === "string") return text;
  }
  return undefined;
}
