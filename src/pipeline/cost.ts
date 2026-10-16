/**
 * What one import cost (`docs/06`, 2026-10-16; issue #92). The definition, not
 * the instrument — `scripts/measure-import.mjs` is the thing you run.
 *
 * Nothing here touches text. The input is counts and token sums read off
 * `import_chunks`, and the output is counts and dollars. This module has no
 * imports so that Node can load it directly, as `src/render/metrics.ts` does.
 */

/** Dollars per million tokens for the model in `wrangler.toml` `ANTHROPIC_MODEL`. */
export interface TokenRates {
  input: number;
  output: number;
  /** The 1-hour write rate: the extraction system prompt carries a 1-hour breakpoint. */
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Read from Anthropic's pricing page on 2026-10-16, never from memory:
 * https://platform.claude.com/docs/en/about-claude/pricing
 *
 * `claude-opus-5` (not 5.5, which is priced lower): $5 input, $25 output, $10
 * for a 1-hour cache write (2x input), $0.50 for a cache read (0.1x input). The
 * page lists the Batch API at $2.50 / $12.50 and says the batch discount stacks
 * with the cache multipliers, so `BATCH_FACTOR` applies to all four.
 *
 * Re-read the page when `ANTHROPIC_MODEL` changes; a stale constant prints a
 * plausible wrong number.
 */
export const RATES_MODEL = "claude-opus-5";
export const RATES_READ_ON = "2026-10-16";
export const RATES_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const RATES: TokenRates = { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 };

/** The Message Batches discount: "50% on both input and output tokens". */
export const BATCH_FACTOR = 0.5;

/** What one import's chunks add up to, as the script's query returns it. */
export interface ImportUsage {
  chunksTotal: number;
  chunksDone: number;
  chunksFailed: number;
  /** Chunks whose four token columns are all null: not recorded, which is not free. */
  chunksWithoutUsage: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ImportCost {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

const PER_MILLION = 1_000_000;

export function estimateCost(usage: ImportUsage, rates: TokenRates = RATES, factor = 1): ImportCost {
  const input = (usage.inputTokens * rates.input * factor) / PER_MILLION;
  const output = (usage.outputTokens * rates.output * factor) / PER_MILLION;
  const cacheWrite = (usage.cacheCreationInputTokens * rates.cacheWrite * factor) / PER_MILLION;
  const cacheRead = (usage.cacheReadInputTokens * rates.cacheRead * factor) / PER_MILLION;
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead };
}

/**
 * The one query. It selects an id, counts and sums and nothing else, so no
 * filename, claim, quote or error body can reach the output. `versionId` null
 * means the newest import; a given id is checked against the shape ids have,
 * because the script puts this in a shell command.
 */
export function importUsageSql(versionId: string | null): string {
  if (versionId !== null && !/^[A-Za-z0-9_-]+$/.test(versionId)) throw new Error("That is not a version id.");
  const pick =
    versionId === null
      ? "v.id = (select id from source_document_versions order by created_at desc limit 1)"
      : `v.id = '${versionId}'`;
  return `
    select json_build_object(
      'id', v.id,
      'chunksTotal', count(c.id),
      'chunksDone', count(c.id) filter (where c.status = 'done'),
      'chunksFailed', count(c.id) filter (where c.status = 'failed'),
      'chunksWithoutUsage', count(c.id) filter (where c.input_tokens is null and c.output_tokens is null
        and c.cache_creation_input_tokens is null and c.cache_read_input_tokens is null),
      'inputTokens', coalesce(sum(c.input_tokens), 0),
      'outputTokens', coalesce(sum(c.output_tokens), 0),
      'cacheCreationInputTokens', coalesce(sum(c.cache_creation_input_tokens), 0),
      'cacheReadInputTokens', coalesce(sum(c.cache_read_input_tokens), 0))
    from source_document_versions v
    left join import_chunks c on c.source_document_version_id = v.id
    where ${pick}
    group by v.id`;
}

const dollars = (n: number) => `$${n.toFixed(4)}`;
const count = (n: number) => n.toLocaleString("en-US");

/** Numbers and ids only. `versionId` is an id; there is no field here for anything else. */
export function formatReport(versionId: string, usage: ImportUsage): string {
  const real = estimateCost(usage);
  const batch = estimateCost(usage, RATES, BATCH_FACTOR);
  const row = (label: string, tokens: number, a: number, b: number) =>
    `${label.padEnd(22)}${count(tokens).padStart(12)}${dollars(a).padStart(12)}${dollars(b).padStart(12)}`;
  const lines = [
    `version              ${versionId}`,
    `chunks               ${usage.chunksTotal}`,
    `done                 ${usage.chunksDone}`,
    `failed               ${usage.chunksFailed}`,
    `no usage recorded    ${usage.chunksWithoutUsage}`,
    "",
    `${"".padEnd(22)}${"tokens".padStart(12)}${"cost".padStart(12)}${"batch".padStart(12)}`,
    row("input", usage.inputTokens, real.input, batch.input),
    row("output", usage.outputTokens, real.output, batch.output),
    row("cache write (1h)", usage.cacheCreationInputTokens, real.cacheWrite, batch.cacheWrite),
    row("cache read", usage.cacheReadInputTokens, real.cacheRead, batch.cacheRead),
    row("total", 0, real.total, batch.total).replace(/ {11}0/, " ".repeat(12)),
    "",
    `rates for ${RATES_MODEL}, read ${RATES_READ_ON} from ${RATES_SOURCE}`,
    `($/MTok: input ${RATES.input}, output ${RATES.output}, cache write ${RATES.cacheWrite}, cache read ${RATES.cacheRead}; batch x${BATCH_FACTOR})`,
  ];
  if (usage.chunksWithoutUsage > 0) {
    lines.push(
      `${usage.chunksWithoutUsage} chunk(s) carry no usage, so the cost above is a floor, not the whole bill.`,
    );
  }
  return lines.join("\n");
}
