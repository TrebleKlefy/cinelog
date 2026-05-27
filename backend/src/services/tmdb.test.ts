import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  tmdbBrowseForUiPage,
  tmdbFetchMovieImportPayload,
  tmdbFetchMovieQuickPayload,
  tmdbMovieBrowseList,
  tmdbMovieGenreNames,
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

  it("returns TMDB genre names", async () => {
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
        if (url.pathname.endsWith("/genre/movie/list")) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                genres: [
                  { id: 28, name: "Action" },
                  { id: 18, name: "Drama" },
                ],
              }),
          };
        }
        return {
          ok: true,
          text: async () => JSON.stringify(sampleDiscover()),
        };
      }),
    );

    const names = await tmdbMovieGenreNames();
    expect(names).toEqual(["Action", "Drama"]);
  });

  it("uses discover when cast, director, or genre filters are supplied", async () => {
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
        if (url.pathname.endsWith("/genre/movie/list")) {
          return {
            ok: true,
            text: async () => JSON.stringify({ genres: [{ id: 28, name: "Action" }] }),
          };
        }
        if (url.pathname.endsWith("/search/person")) {
          return {
            ok: true,
            text: async () => JSON.stringify({ results: [{ id: 99, name: "Actor", known_for_department: "Acting" }] }),
          };
        }
        if (url.pathname.endsWith("/discover/movie")) {
          expect(url.searchParams.get("with_genres")).toBe("28");
          expect(url.searchParams.get("with_cast")).toBe("99");
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                ...sampleDiscover(),
                results: [{ id: 42, title: "Echo City", release_date: "2021-06-06", poster_path: "/test.jpg", vote_average: 7.42 }],
              }),
          };
        }
        return {
          ok: true,
          text: async () => JSON.stringify(sampleDiscover()),
        };
      }),
    );

    const ui = await tmdbBrowseForUiPage({
      cast: "Actor",
      genre: "Action",
      uiPage: 1,
      pageSize: 28,
    });
    expect(ui.items[0]?.title).toBe("Echo City");
  });

  it("falls back to trending when no browse filters are supplied", async () => {
    const ui = await tmdbBrowseForUiPage({ uiPage: 1, pageSize: 28 });
    expect(ui.items.length).toBeGreaterThan(0);
  });

  it("uses search when only a title query is supplied", async () => {
    const ui = await tmdbBrowseForUiPage({ q: "echo", uiPage: 1, pageSize: 10 });
    expect(ui.pageSize).toBe(10);
    expect(ui.items.length).toBeGreaterThan(0);
  });

  it("returns empty browse pages when genre names cannot be resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | Request | URL) => {
        const urlStr =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/genre/movie/list")) {
          return {
            ok: true,
            text: async () => JSON.stringify({ genres: [{ id: 28, name: "Action" }] }),
          };
        }
        return { ok: true, text: async () => JSON.stringify(sampleDiscover()) };
      }),
    );

    const ui = await tmdbBrowseForUiPage({ genre: "Unknown Genre", uiPage: 1, pageSize: 28 });
    expect(ui.items).toEqual([]);
    expect(ui.total).toBe(0);
  });

  it("returns empty browse pages when cast names cannot be resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | Request | URL) => {
        const urlStr =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/search/person")) {
          return { ok: true, text: async () => JSON.stringify({ results: [] }) };
        }
        return { ok: true, text: async () => JSON.stringify(sampleDiscover()) };
      }),
    );

    const ui = await tmdbBrowseForUiPage({ cast: "Nobody", uiPage: 1, pageSize: 28 });
    expect(ui.items).toEqual([]);
  });

  it("filters discover rows by title when query and sub-filters are both set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | Request | URL) => {
        const urlStr =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/genre/movie/list")) {
          return {
            ok: true,
            text: async () => JSON.stringify({ genres: [{ id: 28, name: "Action" }] }),
          };
        }
        if (url.pathname.endsWith("/discover/movie")) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                ...sampleDiscover(),
                results: [
                  { id: 42, title: "Echo City", release_date: "2021-06-06", poster_path: "/test.jpg", vote_average: 7.42 },
                  { id: 43, title: "Other Film", release_date: "2021-06-06", poster_path: null, vote_average: 6.1 },
                ],
              }),
          };
        }
        return { ok: true, text: async () => JSON.stringify(sampleDiscover()) };
      }),
    );

    const ui = await tmdbBrowseForUiPage({
      q: "echo",
      genre: "Action",
      uiPage: 1,
      pageSize: 28,
    });
    expect(ui.items).toHaveLength(1);
    expect(ui.items[0]?.title).toBe("Echo City");
  });

  it("resolves directors via crew discover filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | Request | URL) => {
        const urlStr =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/search/person")) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                results: [
                  { id: 77, name: "Director Person", known_for_department: "Directing" },
                  { id: 88, name: "Other Person", known_for_department: "Acting" },
                ],
              }),
          };
        }
        if (url.pathname.endsWith("/discover/movie")) {
          expect(url.searchParams.get("with_crew")).toBe("77");
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                ...sampleDiscover(),
                results: [{ id: 55, title: "Directed", release_date: "2020-01-01", poster_path: null, vote_average: 8 }],
              }),
          };
        }
        return { ok: true, text: async () => JSON.stringify(sampleDiscover()) };
      }),
    );

    const ui = await tmdbBrowseForUiPage({ director: "Director Person", uiPage: 1, pageSize: 28 });
    expect(ui.items[0]?.title).toBe("Directed");
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

  it("imports quick movie payloads without credits append", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 501,
            title: " Quick Title ",
            overview: " Synopsis ",
            runtime: 95,
            release_date: "2015-05-05",
            poster_path: "/quick.jpg",
            vote_average: 6.7,
            genres: [{ id: 2, name: "Comedy" }],
            external_ids: { imdb_id: "tt7654321" },
          }),
      }),
    );

    const payload = await tmdbFetchMovieQuickPayload(501);
    expect(payload.tmdbId).toBe(501);
    expect(payload.title).toBe("Quick Title");
    expect(payload.imdbId).toBe("tt7654321");
    expect(payload.genreNames).toEqual(["Comedy"]);
    expect(payload.tmdbVoteAverage).toBe(6.7);
  });

  it("normalizes quick payloads with missing optional fields", async () => {
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 502,
            title: "   ",
            overview: "",
            runtime: 0,
            release_date: "2010-01-01",
            poster_path: null,
            vote_average: Number.NaN,
            genres: [],
            external_ids: { imdb_id: null },
          }),
      }),
    );

    const payload = await tmdbFetchMovieQuickPayload(502);
    expect(payload.title).toBe("Untitled");
    expect(payload.runtimeMinutes).toBeNull();
    expect(payload.imdbId).toBeNull();
    expect(payload.tmdbVoteAverage).toBeNull();
    expect(payload.synopsis).toBeNull();
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
