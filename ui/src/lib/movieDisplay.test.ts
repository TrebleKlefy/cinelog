import { describe, expect, it } from "vitest";
import {
  formatRuntimeMinutes,
  getCatalogBadgeScore,
  getImdbScore,
  getRottenTomatoesPercent,
  imdbBadgeTier,
  rtBadgeTier,
  type ExternalRatingDTO,
} from "./movieDisplay.ts";

describe("movieDisplay helpers", () => {
  const sample: ExternalRatingDTO[] = [
    { source: "IMDB", value: 7.8, scale: 10, raw: "7.8" },
    { source: "TMDB", value: 82, scale: 10, raw: null },
  ];

  it("reads IMDb score when present", () => {
    expect(getImdbScore(sample)).toBe(7.8);
    expect(getImdbScore(undefined)).toBeNull();
  });

  it("prefers IMDb 10‑pt badge then TMDB fallback", () => {
    expect(getCatalogBadgeScore(sample)).toBe(7.8);
    const tmdbOnly: ExternalRatingDTO[] = [{ source: "TMDB", value: 6.2, scale: 10, raw: null }];
    expect(getCatalogBadgeScore(tmdbOnly)).toBe(6.2);
    expect(getCatalogBadgeScore([{ source: "IMDB", value: 5, scale: 5, raw: null }])).toBeNull();
  });

  it("formats runtime minutes", () => {
    expect(formatRuntimeMinutes(null)).toBeNull();
    expect(formatRuntimeMinutes(0)).toBeNull();
    expect(formatRuntimeMinutes(45)).toBe("45min");
    expect(formatRuntimeMinutes(120)).toBe("2h");
    expect(formatRuntimeMinutes(92)).toBe("1h 32min");
  });

  it("classifies IMDb badge tiers", () => {
    expect(imdbBadgeTier(7.2)).toBe("high");
    expect(imdbBadgeTier(6.2)).toBe("mid");
    expect(imdbBadgeTier(5)).toBe("low");
  });

  it("reads Rotten Tomatoes percent when scale is 0–100", () => {
    const ratings: ExternalRatingDTO[] = [{ source: "ROTTEN_TOMATOES", value: 85, scale: 100, raw: "85%" }];
    expect(getRottenTomatoesPercent(ratings)).toBe(85);
    expect(getRottenTomatoesPercent(undefined)).toBeNull();
    expect(getRottenTomatoesPercent([{ source: "ROTTEN_TOMATOES", value: 85, scale: 10, raw: null }])).toBeNull();
  });

  it("classifies Rotten Tomatoes badge tiers", () => {
    expect(rtBadgeTier(85)).toBe("high");
    expect(rtBadgeTier(60)).toBe("mid");
    expect(rtBadgeTier(40)).toBe("low");
  });
});
