import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  tmdbFetchMovieImportPayload,
  tmdbMovieBrowseList,
  tmdbPosterUrl,
  tmdbSearchForUiPage,
  tmdbSearchMovies,
  tmdbTrendingForUiPage,
} from "./tmdb.js";

const sampleDiscover = () => ({
  page: 1,
  total_pages: 40,
  total_results: 800,
  results: [
    {
      id: 42,
      title: "Echo City",
      release_date: "2021-06-06",
      poster_path: "/test.jpg",
      vote_average: 7.42,
    },
  ],
});

describe("tmdbPosterUrl", () => {
  it("handles null-ish paths", () => {
    expect(tmdbPosterUrl(null)).toBeNull();
    expect(tmdbPosterUrl(undefined)).toBeNull();
  });

  it("prepends CDN host", () => {
    expect(tmdbPosterUrl("/w.jpg")).toContain("/t/p/w500/w.jpg");
  });

  it("normalizes bare poster filenames", () => {
    expect(tmdbPosterUrl("w.jpg")).toContain("/t/p/w500/w.jpg");
  });
});

describe("tmdb REST adapters", () => {
  beforeEach(() => {
    vi.stubEnv("TMDB_API_KEY", "stub-key-for-tests");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | Request | URL) => {
        const urlStr =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(urlStr);
        const pageNum = Number(url.searchParams.get("page") ?? "1");
        const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              ...sampleDiscover(),
              page,
            }),
        };
      }),
    );
  });

  it("maps search responses", async () => {
    const search = await tmdbSearchMovies("echo", 1);
    expect(search.items[0]?.tmdbId).toBe(42);
    expect(search.items[0]?.releaseYear).toBe(2021);
  });

  it("prefers Bearer tokens when TMDB JWT env variables are wired", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "jwt-like");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(sampleDiscover()),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await tmdbSearchMovies("echo");

    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ headers: { Authorization: "Bearer jwt-like" } }));
  });

  it("pads skeletal rows with placeholders when studios omit headlines", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            page: 1,
            total_pages: 2,
            total_results: 2,
            results: [
              { id: 9, poster_path: null, release_date: "weird-value", vote_average: Number.NaN },
            ],
          }),
      }),
    );

    const search = await tmdbSearchMovies("ghost", 1);
    expect(search.items[0]?.title).toBe("Untitled");
    expect(search.items[0]?.releaseYear).toBeNull();
    expect(search.items[0]?.voteAverage).toBeNull();
  });

  it("aggregates UI pages for trending", async () => {
    const ui = await tmdbTrendingForUiPage("week", 1, 28);
    expect(ui.pageSize).toBe(28);
    expect(ui.items.length).toBeGreaterThan(0);
  });

  it("aggregates UI pages for search", async () => {
    const ui = await tmdbSearchForUiPage("echo", 2, 10);
    expect(ui.page).toBe(2);
  });

  it("throws when credentials missing", async () => {
    vi.unstubAllEnvs();
    await expect(tmdbSearchMovies("q", 1)).rejects.toMatchObject({ status: 503 });
  });

  it("propagates HTTP failures from TMDB", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Invalid key",
      }),
    );
    await expect(tmdbSearchMovies("q", 1)).rejects.toMatchObject({ status: 401 });
  });

  it("complains about non-JSON payloads", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "not json",
      }),
    );
    await expect(tmdbSearchMovies("q", 1)).rejects.toMatchObject({ status: 502 });
  });

  it("imports movie payloads with crew + cast parsing", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 500,
            title: "Importable",
            overview: "Plot",
            runtime: 120,
            release_date: "2010-01-01",
            poster_path: "/p.jpg",
            vote_average: 8.1,
            genres: [{ id: 1, name: "Drama" }],
            credits: {
              cast: [{ name: " Actor ", character: " Hero " }],
              crew: [{ name: " Director ", job: "Director" }],
            },
            external_ids: { imdb_id: "tt1234567" },
          }),
      }),
    );

    const payload = await tmdbFetchMovieImportPayload(500);
    expect(payload.imdbId).toBe("tt1234567");
    expect(payload.directors[0]).toBe("Director");
    expect(payload.cast[0]?.name).toBe("Actor");
  });

  it("returns curated TMDB marquee lists alongside search adapters", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            ...sampleDiscover(),
            page: 2,
            total_results: 100,
          }),
      }),
    );

    const curated = await tmdbMovieBrowseList("now_playing", 2);
    expect(curated.page).toBe(2);
    expect(curated.total).toBe(100);
  });

  it("rejects malformed release markers when hydrating imports", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 12,
            title: "Misdated",
            release_date: "12-XX-YYYY",
          }),
      }),
    );
    await expect(tmdbFetchMovieImportPayload(12)).rejects.toMatchObject({ status: 422 });
  });

  it("rejects movies without release years", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 9,
            title: "NoDate",
            release_date: null,
          }),
      }),
    );
    await expect(tmdbFetchMovieImportPayload(9)).rejects.toMatchObject({ status: 422 });
  });
});
