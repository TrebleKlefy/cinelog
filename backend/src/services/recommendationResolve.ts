import { tmdbSearchMovies, type TmdbMovieBrowseItem } from "./tmdb.js";
import {
  chatCompletionActiveModel,
  normalizeRecommendationsFromParse,
  normalizeTitleForMatch,
  parseJsonFromLlmText,
  type ActiveLlmConfig,
  type RecommendationsResult,
  type RecommendationRow,
} from "./llm.js";

const TARGET_COUNT = 7;
const INITIAL_CANDIDATE_TARGET = 11;
const MAX_REPLACEMENT_LLM_ROUNDS = 3;
const ACCEPT_TMDB_CONFIDENCE_SCORE_MIN = 95;

type RawRec = { title: string; year?: number; why: string };

function rowKey(raw: RawRec): string {
  const y = raw.year ?? "";
  return `${normalizeTitleForMatch(raw.title)}|${y}`;
}

function candidateTmdbConfidence(item: TmdbMovieBrowseItem, wantTitle: string, wantYear?: number): number {
  const wt = normalizeTitleForMatch(wantTitle);
  const it = normalizeTitleForMatch(item.title);
  let score = 0;

  if (it === wt) score += 120;
  else if (it.startsWith(wt + " ") || it.startsWith(wt + ":") || it.startsWith(wt + "—")) score += 108;
  else if (wt.length >= 5 && it.includes(wt)) score += 72;
  else if (it.length >= 5 && wt.includes(it)) score += 66;

  const y = item.releaseYear ?? undefined;
  if (wantYear != null && wantYear >= 1888 && y != null) {
    const d = Math.abs(y - wantYear);
    if (d === 0) score += 36;
    else if (d === 1) score += 18;
    else if (d === 2) score += 8;
    else score -= 28;
  }

  return score;
}

/**
 * Resolve canonical title/year → TMDB best search hit when confidence clears the bar.
 */
export async function resolveTitleToTmdbBest(title: string, year?: number): Promise<TmdbMovieBrowseItem | null> {
  const qRaw = `${title}${year != null && year >= 1888 ? ` ${year}` : ""}`.trim();
  const q = qRaw.length > 180 ? qRaw.slice(0, 180) : qRaw;
  if (!q.length) return null;

  try {
    const { items } = await tmdbSearchMovies(q, 1);
    if (!items.length) return null;

    let best: { item: TmdbMovieBrowseItem; score: number } | null = null;
    for (const it of items) {
      const s = candidateTmdbConfidence(it, title, year);
      if (!best || s > best.score) best = { item: it, score: s };
    }
    if (!best || best.score < ACCEPT_TMDB_CONFIDENCE_SCORE_MIN) return null;

    /** Single weak hit from TMDB: allow slightly softer threshold */
    if (items.length === 1 && best.score >= 82) return best.item;

    return best.item;
  } catch {
    return null;
  }
}

async function enrichSuggestionRaw(raw: RawRec): Promise<RecommendationRow | null> {
  const tmdb = await resolveTitleToTmdbBest(raw.title, raw.year);
  if (!tmdb) return null;

  return {
    title: tmdb.title,
    year: tmdb.releaseYear ?? raw.year ?? undefined,
    posterUrl: tmdb.posterUrl,
    tmdbId: tmdb.tmdbId,
    why: raw.why,
  };
}

function buildInitialMessages(historyContext: string): { system: string; user: string } {
  const system = `You are an expert movie recommender.

The paste below summarizes the user's ACTUAL viewing history (with genres where known) and their personal numerical ratings.

Task: Recommend exactly ${INITIAL_CANDIDATE_TARGET} DISTINCT mainstream theatrical/streaming films they would likely enjoy NEXT. Aim for thematic variety unless their tastes are very narrow.

Rules:
- Return ONLY strict JSON — no prose outside the JSON payload.
- NEVER include UUIDs — only canonical film TITLE plus optional release YEAR and WHY rationale strings.
- Titles MUST closely match spelling used by TheMovieDatabase/TMDB search for hit titles.

Exact JSON schema:
{"recommendations":[{"title":"string","year":number optional,"why":"tie rationale to moods/genres gleaned"}],"disclaimer":"optional string"}

WHY rationales: ONE concise sentence each referencing cues from supplied history whenever possible.`;

  const user = `User viewing history & ratings snapshot:\n${historyContext}\n\nReturn the JSON array now (${INITIAL_CANDIDATE_TARGET} recommendation objects).`;

  return { system, user };
}

function describeAcceptedForPrompt(accepted: RecommendationRow[]): string {
  return accepted.map((r) => `- ${r.title}${r.year != null ? ` (${r.year})` : ""}`).join("\n");
}

function describeFailedForPrompt(failedRaw: RawRec[]): string {
  return failedRaw
    .map((f) => `- ${f.title}${f.year != null ? ` (${f.year})` : ""}`)
    .join("\n");
}

function buildReplacementMessages(params: {
  historyContext: string;
  failedSuggestions: RawRec[];
  accepted: RecommendationRow[];
  replacementCount: number;
}): { system: string; user: string } {
  const { historyContext, failedSuggestions, accepted, replacementCount } = params;
  const system = `TMDB-aligned movie substitutes specialist.

PRIOR cinematic picks failed fuzzy verification against TMDB search OR were absent locally. Produce EXACTLY ${replacementCount} DISTINCT substitutes that are marquee English-language searchable FEATURE films.

Return STRICT JSON ONLY with schema:
{"recommendations":[{"title":"string spelling per TMDB","year":number optional,"why":"fresh tie referencing taste signals"}],"disclaimer":"optional string"}

RULES:
- Absolutely avoid duplicating ALREADY ACCEPTED titles.
- Prefer iconic/well-catalogued titles studios definitely indexed on TMDB.
- WHY text must logically reference cues from HISTORY context—not generic fluff.`;

  const user =
    `PRIMARY taste context:\n${historyContext}\n\n` +
    `UNSUPPORTED / MISSING PRIOR SHORTLIST (conceptually REPLACE these):\n${describeFailedForPrompt(failedSuggestions)}\n\n` +
    `LOCKED ACCEPTED PICKS — NEVER DUPLICATE:\n${describeAcceptedForPrompt(accepted) || "(none yet)."}\n\n` +
    `Return exactly ${replacementCount} substitutes as JSON recommendation objects now.`;

  return { system, user };
}

/**
 * Runs the live LLM + TMDB resolution loop (+ TMDB-guided replacement passes capped at MAX_REPLACEMENT_LLM_ROUNDS).
 */
export async function runLiveRecommendationsWithTmdbRetry(
  params: {
    historyContext: string;
  },
  config: ActiveLlmConfig,
): Promise<RecommendationsResult> {
  const { historyContext } = params;

  const initialMsgs = buildInitialMessages(historyContext);
  const initialText = await chatCompletionActiveModel(config, initialMsgs.system, initialMsgs.user);
  const initialParsed = parseJsonFromLlmText(initialText);

  let rootDisclaimer =
    typeof (initialParsed as RecommendationsResult).disclaimer === "string"
      ? ((initialParsed as RecommendationsResult).disclaimer as string).trim()
      : "";

  let salvageMeta = "";

  const initialRaw = normalizeRecommendationsFromParse(initialParsed);

  if (!initialRaw.length) throw new Error("Initial recommendation model payload contained zero usable rows.");

  /** Work queue seeded from debut LLM output (plus corrective passes) */
  const pending: RawRec[] = initialRaw.slice();

  /** Final surfaced rows respecting TARGET_COUNT */
  const settled: RecommendationRow[] = [];

  /** Captures rejects since the last corrective AI salvage pass */
  const rejectBacklog: RawRec[] = [];

  const seenSuggestions = new Set<string>();
  const seenFinalKeys = new Set<string>();

  let replacementPassesUsed = 0;

  /**
   * @returns skipped | settled | unresolved
   */
  async function tryIngestSuggestion(raw: RawRec): Promise<"skipped" | "settled" | "unresolved"> {
    const suggestionKey = rowKey(raw);

    /** Skip duplicate brainstorming rows */
    if (seenSuggestions.has(suggestionKey)) return "skipped";
    seenSuggestions.add(suggestionKey);

    const enriched = await enrichSuggestionRaw(raw);
    if (!enriched) return "unresolved";

    const fk =
      enriched.tmdbId != null
        ? `tmdb:${enriched.tmdbId}`
        : `free:${normalizeTitleForMatch(enriched.title)}|${enriched.year ?? ""}`;

    if (seenFinalKeys.has(fk)) return "skipped";
    seenFinalKeys.add(fk);

    settled.push(enriched);

    return "settled";
  }

  for (let safety = 0; safety < 40 && settled.length < TARGET_COUNT; safety += 1) {
    while (pending.length && settled.length < TARGET_COUNT) {
      const piece = pending.shift()!;
      const verdict = await tryIngestSuggestion(piece);

      switch (verdict) {
        case "unresolved":
          rejectBacklog.push(piece);
          break;
        case "skipped":
        case "settled":
        default:
          break;
      }
    }

    if (settled.length >= TARGET_COUNT) break;

    /** Nothing queued and nothing salvageable → exit before burning LLM quota */
    if (!pending.length && !rejectBacklog.length) break;

    if (!rejectBacklog.length) {
      /** No TMDB/catalog rejects to reconcile — salvage LLM irrelevant */
      break;
    }

    if (replacementPassesUsed >= MAX_REPLACEMENT_LLM_ROUNDS) {
      salvageMeta = `${salvageMeta.trim()} Exhausted TMDB-guided AI salvage (${MAX_REPLACEMENT_LLM_ROUNDS}/${MAX_REPLACEMENT_LLM_ROUNDS}).`.trim();
      break;
    }

    replacementPassesUsed += 1;
    const neededExtras = TARGET_COUNT - settled.length;
    const refillAsk = Math.min(12, Math.max(neededExtras + 5, 8));

    const snapshotFails = [...rejectBacklog];
    rejectBacklog.length = 0;

    let replenished: RawRec[] = [];
    try {
      const { system, user } = buildReplacementMessages({
        historyContext,
        failedSuggestions: snapshotFails,
        accepted: settled,
        replacementCount: refillAsk,
      });
      const repText = await chatCompletionActiveModel(config, system, user);
      replenished = normalizeRecommendationsFromParse(parseJsonFromLlmText(repText));
      salvageMeta = `${salvageMeta.trim()} Ran TMDB-aligned salvage wave ${replacementPassesUsed}/${MAX_REPLACEMENT_LLM_ROUNDS}.`.trim();
    } catch {
      salvageMeta =
        `${salvageMeta.trim()} Salvage pass ${replacementPassesUsed}/${MAX_REPLACEMENT_LLM_ROUNDS} failed during JSON ingest — exiting AI salvage early.`.trim();
      snapshotFails.forEach((f) => rejectBacklog.push(f));
      break;
    }

    if (!replenished.length) {
      snapshotFails.forEach((f) => rejectBacklog.push(f));
      break;
    }

    pending.unshift(...replenished);
  }

  /** Hard trim for API contract */
  const recommendations = settled.slice(0, TARGET_COUNT);

  const disclaimerParts = [(rootDisclaimer ?? "").trim(), salvageMeta.trim()].filter(Boolean);
  disclaimerParts.push("Poster art comes from TMDB when confidence clears.");

  return {
    recommendations,
    disclaimer: disclaimerParts.join(" ").trim() || undefined,
  };
}

/** Enrich NL search matches with TMDB poster art and ids for card UI. */
export async function hydrateNlSearchMatches(
  matches: Array<{ title: string; year?: number; movieId?: string; reason: string }>,
): Promise<
  Array<{
    title: string;
    year?: number;
    reason: string;
    tmdbId?: number | null;
    posterUrl?: string | null;
    voteAverage?: number | null;
  }>
> {
  const out: Array<{
    title: string;
    year?: number;
    reason: string;
    tmdbId?: number | null;
    posterUrl?: string | null;
    voteAverage?: number | null;
  }> = [];

  for (const match of matches) {
    const enriched = await enrichNlSearchMatch(match);
    if (enriched.tmdbId != null) out.push(enriched);
  }

  return out;
}

async function enrichNlSearchMatch(match: {
  title: string;
  year?: number;
  movieId?: string;
  reason: string;
}): Promise<{
  title: string;
  year?: number;
  reason: string;
  tmdbId?: number | null;
  posterUrl?: string | null;
  voteAverage?: number | null;
}> {
  const tmdb = await resolveTitleToTmdbBest(match.title, match.year);
  if (tmdb) {
    return {
      title: tmdb.title,
      year: tmdb.releaseYear ?? match.year,
      reason: match.reason,
      posterUrl: tmdb.posterUrl,
      tmdbId: tmdb.tmdbId,
      voteAverage: tmdb.voteAverage,
    };
  }

  return {
    title: match.title,
    year: match.year,
    reason: match.reason,
    posterUrl: null,
    tmdbId: null,
    voteAverage: null,
  };
}
