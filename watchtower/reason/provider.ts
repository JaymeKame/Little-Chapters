import { REPEAT_JUDGMENT_JSON_SCHEMA } from "./prompt.ts";
import type { ProviderResponse, ReasoningProvider } from "./types.ts";

type ProviderOptions = { apiKey: string; model?: string; baseUrl?: string; inputUsdPerMillion?: number; outputUsdPerMillion?: number };

export class OpenAIResponsesProvider implements ReasoningProvider {
  readonly model: string;
  private readonly options: ProviderOptions;
  constructor(options: ProviderOptions) { this.options = options; this.model = options.model ?? "gpt-5-mini"; }

  async judge(systemPrompt: string, input: unknown, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await fetch(`${this.options.baseUrl ?? "https://api.openai.com/v1"}/responses`, {
      method: "POST", signal,
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, instructions: systemPrompt, input: JSON.stringify(input),
        text: { format: { type: "json_schema", name: "repeat_judgment", strict: true, schema: REPEAT_JUDGMENT_JSON_SCHEMA } } }),
    });
    if (!response.ok) throw new Error(`Reasoning provider returned HTTP ${response.status}`);
    const raw = await response.json() as Record<string, unknown>;
    const outputText = typeof raw.output_text === "string" ? raw.output_text : extractOutputText(raw.output);
    if (!outputText) throw new Error("Reasoning provider returned no structured output");
    const usageRecord = raw.usage as Record<string, unknown> | undefined;
    const usage = usageRecord ? { inputTokens: number(usageRecord.input_tokens), outputTokens: number(usageRecord.output_tokens), totalTokens: number(usageRecord.total_tokens) } : undefined;
    const estimatedCostUsd = usage && this.options.inputUsdPerMillion !== undefined && this.options.outputUsdPerMillion !== undefined
      ? ((usage.inputTokens ?? 0) * this.options.inputUsdPerMillion + (usage.outputTokens ?? 0) * this.options.outputUsdPerMillion) / 1_000_000 : undefined;
    return { value: JSON.parse(outputText), raw, usage, estimatedCostUsd };
  }
}

const number = (value: unknown) => typeof value === "number" ? value : undefined;
function extractOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) for (const content of Array.isArray(item?.content) ? item.content : [])
    if (content?.type === "output_text" && typeof content.text === "string") return content.text;
  return undefined;
}
