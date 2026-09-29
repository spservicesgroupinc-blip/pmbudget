/**
 * Robust DeepSeek chat-completions client (server-only).
 *
 * Improvements over the original single-shot call:
 *  - bounded retries with exponential backoff for 429/5xx/network/timeouts
 *  - finish_reason handling: truncated responses retry with a compact hint
 *  - JSON extraction (fences, prose) plus brace-balancing repair and an
 *    optional model-driven repair pass before giving up
 *  - usage/attempt telemetry logging for cost visibility
 */
export interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface DeepSeekJsonSuccess<T> {
  data: T;
  raw: string;
  usage?: DeepSeekUsage;
  attempts: number;
  model: string;
  repaired: boolean;
  truncated: boolean;
}

export interface DeepSeekJsonOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  attempts?: number;
  label?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function resolveModel(): string {
  return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
}

export function resolveBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'DeepSeekApiError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestOnce(
  system: string,
  user: string,
  opts: { temperature: number; maxTokens: number; timeoutMs: number; label: string; repairMessages?: ChatMessage[] }
): Promise<{ text: string; finishReason: string; usage?: DeepSeekUsage }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new ApiError('DEEPSEEK_API_KEY is not configured', 500, false);

  const model = resolveModel();
  const isReasoner = model.includes('reasoner');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const messages: ChatMessage[] = opts.repairMessages ?? [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  try {
    const res = await fetch(`${resolveBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(isReasoner ? {} : { response_format: { type: 'json_object' } }),
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new ApiError(
        `HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`,
        res.status,
        retryable
      );
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: DeepSeekUsage;
    };
    const choice = payload?.choices?.[0];
    const text = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason ?? 'stop';
    if (!text) throw new ApiError('empty response content', 502, true);
    return { text, finishReason, usage: payload?.usage };
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts the first balanced JSON object from model output. */
function extractBalanced(text: string): { json: string; complete: boolean } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let depthArray = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0 && depthArray === 0) {
        return { json: source.slice(start, i + 1), complete: true };
      } 
    } else if (ch === '[') depthArray++;
    else if (ch === ']') depthArray--;
  }
  return { json: source.slice(start), complete: false };
}

/** Best-effort balancing of a truncated JSON object. */
function balanceJson(input: string): string {
  let out = input.trimEnd();
  out = out.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  while (stack.length) out += stack.pop();
  return out;
}

function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const extracted = extractBalanced(text);
  if (!extracted) return { ok: false, error: 'no JSON object found in response' };
  const candidates = [
    extracted.complete ? extracted.json : balanceJson(extracted.json),
    extracted.json.replace(/,\s*([}\]])/g, '$1'),
    balanceJson(extracted.json),
  ];
  let lastError = 'invalid JSON';
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
}

export async function deepseekJson<T>(options: DeepSeekJsonOptions): Promise<T> {
  return (await deepseekJsonWithMeta<T>(options)).data;
}

export async function deepseekJsonWithMeta<T>(
  options: DeepSeekJsonOptions
): Promise<DeepSeekJsonSuccess<T>> {
  const label = options.label || 'deepseek';
  const maxAttempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 240_000;
  const maxTokens =
    options.maxTokens ?? (Number(process.env.DEEPSEEK_MAX_TOKENS) || 8192);
  const temperature = options.temperature ?? 0.1;
  const model = resolveModel();

  let lastError: unknown;
  let attempts = 0;
  let compact = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    try {
      const user = compact
        ? `${options.user}\n\nIMPORTANT: The previous response hit the token limit. Re-output the COMPLETE JSON object and keep every string terse.`
        : options.user;
      const result = await requestOnce(options.system, user, {
        temperature,
        maxTokens,
        timeoutMs,
        label,
      });

      let parsed = parseJsonLoose(result.text);
      let repaired = false;

      if (!parsed.ok && attempt < maxAttempts) {
        // Model-driven repair pass on its own broken output.
        const repairMessages: ChatMessage[] = [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
          { role: 'assistant', content: result.text.slice(0, 24_000) },
          {
            role: 'user',
            content: `The JSON above is invalid (${parsed.error}). Return ONLY the corrected, complete JSON object with no markdown or commentary.`,
          },
        ];
        const fixed = await requestOnce(options.system, '', {
          temperature: 0,
          maxTokens,
          timeoutMs,
          label: `${label}:repair`,
          repairMessages,
        });
        const repairedParse = parseJsonLoose(fixed.text);
        if (repairedParse.ok) {
          parsed = repairedParse;
          repaired = true;
          console.warn(`[deepseek] ${label}: repaired invalid JSON on attempt ${attempt}.`);
        } else {
          lastError = new Error(`Invalid JSON after repair pass: ${repairedParse.error}`);
        }
      }

      if (parsed.ok) {
        const truncated = result.finishReason === 'length';
        if (truncated) {
          console.warn(`[deepseek] ${label}: response hit the token limit; JSON recovered via repair.`);
        }
        console.log(
          `[deepseek] ${label}: ok (attempt ${attempt}/${maxAttempts}, finish=${result.finishReason}, tokens=${
            result.usage?.total_tokens ?? 'n/a'
          })`
        );
        return {
          data: parsed.value as T,
          raw: result.text,
          usage: result.usage,
          attempts: attempt,
          model,
          repaired,
          truncated,
        };
      }

      if (result.finishReason === 'length') {
        compact = true;
        lastError = new Error('Model response was truncated by the token limit');
        continue;
      }
      lastError = new Error(`Invalid JSON: ${parsed.error}`);
    } catch (err) {
      lastError = err;
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const retryable = isAbort || !(err instanceof ApiError) || err.retryable;
      if (!retryable) break;
      if (attempt < maxAttempts) {
        await sleep(600 * Math.pow(3, attempt - 1) + Math.floor(Math.random() * 250));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`DeepSeek request failed (${label}) after ${attempts} attempt(s): ${message}`);
}
