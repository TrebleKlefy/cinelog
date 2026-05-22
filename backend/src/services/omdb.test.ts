import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { omdbGetByImdbId, omdbSearch } from "./omdb.js";

describe("omdb helpers", () => {
  beforeEach(() => {
    vi.stubEnv("OMDB_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires API key configuration", async () => {
    vi.unstubAllEnvs();
    await expect(omdbSearch({ query: "x", page: 1 })).rejects.toMatchObject({ status: 503 });
  });

  it("parses successful search responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Response: "True",
          Search: [
            { Title: "Alien", Year: "1979", imdbID: "tt0078748", Type: "movie", Poster: "N/A" },
          ],
          totalResults: "198",
        }),
      }),
    );

    const out = await omdbSearch({ query: "alien", page: 1 });
    expect(out.items[0]?.imdbId).toBe("tt0078748");
    expect(out.total).toBe(198);
  });

  it("treats not-found server errors as empty pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Response: "False",
          Error: "Movie not found!",
        }),
      }),
    );

    await expect(omdbSearch({ query: "zzz", page: 1 })).resolves.toEqual({
      total: 0,
      page: 1,
      items: [],
    });
  });

  it("maps HTTP failures to 502 errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(omdbSearch({ query: "q", page: 1 })).rejects.toMatchObject({ status: 502 });
  });

  it("guards against malformed JSON envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ foo: "bar" }),
      }),
    );
    await expect(omdbSearch({ query: "q", page: 1 })).rejects.toMatchObject({ status: 502 });
  });

  it("loads detail payloads with RT parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Response: "True",
          imdbID: "tt0078748",
          Title: "Alien",
          Year: "1979",
          Type: "movie",
          Poster: "N/A",
          Plot: "In space",
          Runtime: "117 min",
          Genre: "Horror",
          Director: "Ridley Scott",
          Actors: "Sigourney Weaver",
          imdbRating: "8.5",
          Ratings: [{ Source: "Rotten Tomatoes", Value: "98%" }],
        }),
      }),
    );

    const detail = await omdbGetByImdbId("tt0078748");
    expect(detail.rottenTomatoesPercent).toBe(98);
    expect(detail.imdbRating).toBe(8.5);
  });

  it("surface 404-ish detail failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ Response: "False", Error: "Incorrect IMDb ID." }),
      }),
    );
    await expect(omdbGetByImdbId("tt0000000")).rejects.toMatchObject({ status: 404 });
  });

  it("maps non-not-found Error responses to transient 502s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ Response: "False", Error: "Quota exceeded upstream" }),
      }),
    );
    await expect(omdbSearch({ query: "boom", page: 1 })).rejects.toMatchObject({ status: 502 });
  });

  it("falls back to page-sized totals when totals are absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Response: "True",
          Search: [
            { Title: "Alpha", Year: "2000", imdbID: "tt100", Type: "movie", Poster: "N/A" },
            { Title: "Beta", Year: "2001", imdbID: "tt101", Type: "movie", Poster: "https://poster" },
          ],
        }),
      }),
    );

    const out = await omdbSearch({ query: "ab", page: 1 });
    expect(out.total).toBe(2);
  });

  it("maps detail HTTP regressions similarly to searches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(omdbGetByImdbId("tt1234567")).rejects.toMatchObject({ status: 502 });
  });

  it("parses rotten scores outside strict percent literals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Response: "True",
          imdbID: "tt0078748",
          Title: "Alien",
          Year: "1979",
          Type: "movie",
          imdbRating: "not-a-number",
          Ratings: [{ Source: "rotten tomato", Value: "80" }],
        }),
      }),
    );

    const detail = await omdbGetByImdbId("tt0078748");
    expect(detail.rottenTomatoesPercent).toBe(80);
    expect(detail.imdbRating).toBeNull();
  });
});
