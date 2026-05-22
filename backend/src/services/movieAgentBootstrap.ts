import { tmdbMovieBrowseList, tmdbTrendingMovies, type TmdbMovieBrowseItem } from "./tmdb.js";

const PICKS_PER_SHELF = 10;

function slicePicks(items: TmdbMovieBrowseItem[]): TmdbMovieBrowseItem[] {
  return items.slice(0, PICKS_PER_SHELF);
}

function describeShelf(label: string, items: TmdbMovieBrowseItem[]): string {
  if (!items.length) return `${label}: (none returned from TMDB)\n`;
  return (
    `${label}:\n` +
    items
      .map((m) => {
        const y = m.releaseYear != null ? ` (${m.releaseYear})` : "";
        const v = m.voteAverage != null ? m.voteAverage.toFixed(1) : "?";
        return `- ${m.title}${y} · TMDB id ${m.tmdbId} · community rating ${v}/10`;
      })
      .join("\n")
  );
}

export type MovieAgentBootstrap = {
  trendingToday: TmdbMovieBrowseItem[];
  topRated: TmdbMovieBrowseItem[];
  nowPlaying: TmdbMovieBrowseItem[];
  /** Compact digest injected into agent system prompt each turn */
  contextForLlm: string;
};

/**
 * Loads live TMDB shelves for concierge chat: buzzing today, all-time acclaim, in theaters now.
 */
export async function buildMovieAgentBootstrap(): Promise<MovieAgentBootstrap> {
  const [trendingDay, topRatedResp, playingResp] = await Promise.all([
    tmdbTrendingMovies("day", 1),
    tmdbMovieBrowseList("top_rated", 1),
    tmdbMovieBrowseList("now_playing", 1),
  ]);

  const trendingToday = slicePicks(trendingDay.items);
  const topRated = slicePicks(topRatedResp.items);
  const nowPlaying = slicePicks(playingResp.items);

  const contextForLlm = [
    describeShelf("Buzzing TODAY (TMDB trending / day)", trendingToday),
    "",
    describeShelf("Highly rated marquee picks (TMDB top_rated first page subset)", topRated),
    "",
    describeShelf("In theaters NOW (TMDB now_playing, US-adjacent list)", nowPlaying),
  ].join("\n");

  return { trendingToday, topRated, nowPlaying, contextForLlm };
}
