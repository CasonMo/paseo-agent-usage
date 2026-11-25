/**
 * Transparent API-equivalent pricing table and estimator for coding agents whose
 * local logs do not record billing amounts (e.g. Claude Code, Codex, Antigravity,
 * Codebuddy). Raw log-reported costs remain authoritative whenever present.
 *
 * All rates are in USD per 1,000,000 tokens.
 */

export interface ModelPriceRate {
  /** USD per 1M fresh (uncached) input tokens. */
  input: number;
  /** USD per 1M output tokens (includes reasoning tokens where folded into output). */
  output: number;
  /** USD per 1M prompt-cache read tokens. */
  cacheRead: number;
  /** USD per 1M prompt-cache write/creation tokens. */
  cacheWrite: number;
}

export interface CustomModelPrice {
  /** Exact model ID or boundary prefix pattern (case-insensitive). */
  model: string;
  /** Optional target model ID to inherit rates from (resolved before optional numeric overrides). */
  mapTo?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type CostSource = "reported" | "estimated" | "mixed" | "unpriced";

export interface TokenCostInput {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reportedCost: number;
}

export interface TokenCostEstimate {
  reportedCostUsd: number;
  estimatedCostUsd: number;
  costUsd: number;
  cacheSavingsUsd: number;
  unpricedTokens: number;
  source: "reported" | "estimated" | "unpriced";
}

const MILLION = 1_000_000;

/**
 * Helper for standard Anthropic prompt-caching ratios (0.1x read, 1.25x 5m write).
 */
function anthropic(input: number, output: number, cacheRead = roundRate(input * 0.1), cacheWrite = roundRate(input * 1.25)): ModelPriceRate {
  return { input, output, cacheRead, cacheWrite };
}

/**
 * Helper for standard OpenAI / Gemini / DeepSeek cached-input ratios (no cache-write surcharge).
 */
function standard(input: number, output: number, cacheRead = roundRate(input * 0.1), cacheWrite = input): ModelPriceRate {
  return { input, output, cacheRead, cacheWrite };
}

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Canonical built-in API list rates (USD per 1M tokens).
 * Keys are normalized (lowercase, dots normalized to hyphens for matching).
 */
export const BUILTIN_MODEL_PRICES: Readonly<Record<string, ModelPriceRate>> = {
  // Anthropic Claude
  "claude-fable-5-2": anthropic(8, 40),
  "claude-fable-5-1": anthropic(10, 50),
  "claude-fable-5": anthropic(10, 50),
  "claude-opus-5-5": anthropic(4, 20),
  "claude-opus-5": anthropic(5, 25),
  "claude-opus-4-8": anthropic(5, 25),
  "claude-opus-4-7": anthropic(5, 25),
  "claude-opus-4-6": anthropic(5, 25),
  "claude-opus-4-5": anthropic(5, 25),
  "claude-opus-4-1": anthropic(15, 75),
  "claude-opus-4": anthropic(15, 75),
  "claude-4-1-opus": anthropic(15, 75),
  "claude-4-opus": anthropic(15, 75),
  "claude-3-opus": anthropic(15, 75),
  "claude-sonnet-5-5": anthropic(2, 10),
  "claude-sonnet-5": anthropic(2, 10),
  "claude-sonnet-4-6": anthropic(3, 15),
  "claude-sonnet-4-5": anthropic(3, 15),
  "claude-sonnet-4": anthropic(3, 15),
  "claude-4-5-sonnet": anthropic(3, 15),
  "claude-4-sonnet": anthropic(3, 15),
  "claude-3-7-sonnet": anthropic(3, 15),
  "claude-3-5-sonnet": anthropic(3, 15),
  "claude-haiku-5-5": anthropic(0.1, 0.5),
  "claude-haiku-5": anthropic(0.1, 0.5),
  "claude-haiku-4-5": anthropic(1, 5),
  "claude-4-5-haiku": anthropic(1, 5),
  "claude-3-5-haiku": anthropic(0.8, 4),
  "claude-3-haiku": anthropic(0.25, 1.25, 0.03, 0.3),

  // OpenAI / Codex
  "gpt-6-2-astra": standard(8, 40),
  "gpt-6-astra": standard(10, 50),
  "gpt-6-2-sol": standard(2, 10),
  "gpt-6-1-sol": standard(2, 10),
  "gpt-6-sol": standard(2, 10),
  "gpt-6-1-terra": standard(1, 5),
  "gpt-6-luna": standard(0.1, 0.5),
  "gpt-5-6-sol": standard(4, 20),
  "gpt-5-6-terra": standard(2, 12),
  "gpt-5-6-luna": standard(0.2, 1.2),
  "gpt-5-5-pro": standard(30, 180),
  "gpt-5-5": standard(5, 30),
  "gpt-5-4-pro": standard(30, 180),
  "gpt-5-4-mini": standard(0.75, 4.5),
  "gpt-5-4-nano": standard(0.2, 1.25),
  "gpt-5-4": standard(2.5, 15),
  "gpt-5-3-codex": standard(1.75, 14),
  "gpt-5-2-codex": standard(1.75, 14),
  "gpt-5-2-pro": standard(21, 168),
  "gpt-5-2": standard(1.75, 14),
  "gpt-5-1-codex-mini": standard(0.25, 2),
  "gpt-5-1-codex-max": standard(1.25, 10),
  "gpt-5-1-codex": standard(1.25, 10),
  "gpt-5-1": standard(1.25, 10),
  "gpt-5-codex": standard(1.25, 10),
  "gpt-5-pro": standard(15, 120),
  "gpt-5-mini": standard(0.25, 2),
  "gpt-5-nano": standard(0.05, 0.4),
  "gpt-5": standard(1.25, 10),
  "gpt-4-1-mini": standard(0.4, 1.6, 0.1),
  "gpt-4-1-nano": standard(0.1, 0.4, 0.025),
  "gpt-4-1": standard(2, 8, 0.5),
  "gpt-4o-mini": standard(0.15, 0.6, 0.075),
  "gpt-4o": standard(2.5, 10, 1.25),
  "o3-pro": standard(20, 80, 5),
  "o3-mini": standard(1.1, 4.4, 0.275),
  "o3": standard(2, 8, 0.5),
  "o4-mini": standard(1.1, 4.4, 0.275),
  "o1-pro": standard(150, 600, 75),
  "o1": standard(15, 60, 7.5),

  // Google Gemini
  "gemini-4-carbon": standard(4, 20),
  "gemini-4-argon": standard(4, 20),
  "gemini-4-neon": standard(3, 15),
  "gemini-4-hydrogen": standard(1.5, 7.5, 0.075),
  "gemini-3-8-flash": standard(0.75, 3.75),
  "gemini-3-7-flash": standard(0.75, 3.75),
  "gemini-3-6-flash": standard(0.75, 3.75),
  "gemini-3-5-flash-lite": standard(0.3, 2.5),
  "gemini-3-5-flash": standard(1.5, 9),
  "gemini-3-1-pro": standard(2, 12),
  "gemini-3-1-flash-lite": standard(0.25, 1.5),
  "gemini-3-pro": standard(2, 12),
  "gemini-3-flash": standard(0.5, 3),
  "gemini-2-5-pro": standard(1.25, 10),
  "gemini-2-5-flash-lite": standard(0.1, 0.4),
  "gemini-2-5-flash": standard(0.3, 2.5),
  "gemini-2-0-flash": standard(0.1, 0.4, 0.025),

  // DeepSeek
  "deepseek-v4-pro": standard(1.32, 3.96),
  "deepseek-v4-1-flash": standard(0.3, 1.2),
  "deepseek-v4-flash": standard(0.14, 0.28),
  "deepseek-r1": standard(0.55, 2.19, 0.14),
  "deepseek-reasoner": standard(0.55, 2.19, 0.14),
  "deepseek-v3": standard(0.28, 0.42),
  "deepseek-chat": standard(0.28, 0.42),
};

const BUILTIN_KEYS_SORTED = Object.keys(BUILTIN_MODEL_PRICES).sort((a, b) => b.length - a.length);
const FREE_RATE: ModelPriceRate = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Normalizes a model identifier for lookup (strips provider prefix and normalizes separators). */
export function normalizeModelId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const slash = trimmed.lastIndexOf("/");
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return base.replace(/\./g, "-");
}

function matchesPrefix(model: string, pattern: string): boolean {
  if (!pattern) return false;
  if (model === pattern) return true;
  if (!model.startsWith(pattern)) return false;
  const boundary = model.charAt(pattern.length);
  return boundary === "-" || boundary === ":" || boundary === "_" || boundary === "@";
}

function finiteNonNeg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isFreeModel(normalized: string): boolean {
  return normalized.endsWith("-free") || normalized.endsWith(":free");
}

function resolveBuiltinRate(normalized: string): ModelPriceRate | null {
  if (!normalized || normalized === "unknown") return null;
  const exact = BUILTIN_MODEL_PRICES[normalized];
  if (exact) return exact;
  for (const key of BUILTIN_KEYS_SORTED) {
    if (matchesPrefix(normalized, key)) return BUILTIN_MODEL_PRICES[key] ?? null;
  }
  if (isFreeModel(normalized)) return FREE_RATE;
  return null;
}

function resolveCustomEntry(
  normalized: string,
  customPrices: readonly CustomModelPrice[] | undefined,
): CustomModelPrice | null {
  if (!customPrices || customPrices.length === 0 || !normalized) return null;
  let best: CustomModelPrice | null = null;
  let bestLen = -1;
  for (const entry of customPrices) {
    const key = normalizeModelId(entry.model);
    if (!key) continue;
    if (key === normalized) return entry;
    if (matchesPrefix(normalized, key) && key.length > bestLen) {
      best = entry;
      bestLen = key.length;
    }
  }
  return best;
}

/**
 * Resolves the USD-per-1M-tokens rate for a model.
 * Precedence: custom override (exact -> longest boundary prefix, with optional `mapTo` alias)
 * -> built-in table (exact -> longest boundary prefix) -> explicit `*-free` -> `null` (unpriced).
 */
export function resolveModelRate(
  model: string,
  customPrices?: readonly CustomModelPrice[],
  depth = 0,
): ModelPriceRate | null {
  const normalized = normalizeModelId(model);
  if (!normalized || depth > 5) return null;

  const custom = resolveCustomEntry(normalized, customPrices);
  if (custom) {
    const mapped = custom.mapTo ? resolveModelRate(custom.mapTo, customPrices, depth + 1) : null;
    const input = finiteNonNeg(custom.input) ?? mapped?.input;
    const output = finiteNonNeg(custom.output) ?? mapped?.output;
    if (input !== undefined || output !== undefined) {
      const resolvedInput = input ?? 0;
      const resolvedOutput = output ?? 0;
      const resolvedCacheRead =
        finiteNonNeg(custom.cacheRead) ?? mapped?.cacheRead ?? roundRate(resolvedInput * 0.1);
      const resolvedCacheWrite =
        finiteNonNeg(custom.cacheWrite) ?? mapped?.cacheWrite ?? resolvedInput;
      return {
        input: resolvedInput,
        output: resolvedOutput,
        cacheRead: resolvedCacheRead,
        cacheWrite: resolvedCacheWrite,
      };
    }
    if (mapped) return mapped;
  }

  return resolveBuiltinRate(normalized);
}

/**
 * Computes effective cost and prompt-cache savings for a token bundle.
 * Raw log-reported cost (`reportedCost > 0`) always takes precedence over estimates.
 */
export function estimateTokenCost(
  model: string,
  tokens: TokenCostInput,
  customPrices?: readonly CustomModelPrice[],
): TokenCostEstimate {
  const input = Math.max(0, tokens.input);
  const output = Math.max(0, tokens.output);
  const cacheRead = Math.max(0, tokens.cacheRead);
  const cacheWrite = Math.max(0, tokens.cacheWrite);
  const reported = Math.max(0, tokens.reportedCost);
  const totalTokens = input + output + cacheRead + cacheWrite;
  const rate = resolveModelRate(model, customPrices);
  const cacheSavingsUsd =
    rate && cacheRead > 0 ? Math.max(0, (cacheRead / MILLION) * (rate.input - rate.cacheRead)) : 0;

  if (reported > 0) {
    return {
      reportedCostUsd: reported,
      estimatedCostUsd: 0,
      costUsd: reported,
      cacheSavingsUsd,
      unpricedTokens: 0,
      source: "reported",
    };
  }

  // Zero-token synthetic placeholders (e.g. `<synthetic>`) are not unpriced usage.
  if (totalTokens <= 0) {
    return {
      reportedCostUsd: 0,
      estimatedCostUsd: 0,
      costUsd: 0,
      cacheSavingsUsd: 0,
      unpricedTokens: 0,
      source: "estimated",
    };
  }

  if (rate) {
    const estimated =
      (input * rate.input + output * rate.output + cacheRead * rate.cacheRead + cacheWrite * rate.cacheWrite) /
      MILLION;
    return {
      reportedCostUsd: 0,
      estimatedCostUsd: estimated,
      costUsd: estimated,
      cacheSavingsUsd,
      unpricedTokens: 0,
      source: "estimated",
    };
  }

  return {
    reportedCostUsd: 0,
    estimatedCostUsd: 0,
    costUsd: 0,
    cacheSavingsUsd: 0,
    unpricedTokens: totalTokens,
    source: "unpriced",
  };
}
