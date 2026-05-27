import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./movieImportTmdb.js", () => ({
  enrichMovieFromTmdb: vi.fn(),
}));

import { enrichMovieFromTmdb } from "./movieImportTmdb.js";
import { resetMovieImportQueueForTests, scheduleMovieImportEnrichment } from "./movieImportQueue.js";

describe("movieImportQueue", () => {
  beforeEach(() => {
    resetMovieImportQueueForTests();
    vi.mocked(enrichMovieFromTmdb).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetMovieImportQueueForTests();
  });

  it("enriches a scheduled TMDB id in the background", async () => {
    scheduleMovieImportEnrichment(42);
    await vi.waitFor(() => {
      expect(enrichMovieFromTmdb).toHaveBeenCalledWith(42);
    });
  });

  it("dedupes duplicate schedules for the same TMDB id", async () => {
    scheduleMovieImportEnrichment(7);
    scheduleMovieImportEnrichment(7);
    await vi.waitFor(() => {
      expect(enrichMovieFromTmdb).toHaveBeenCalledTimes(1);
    });
  });

  it("continues after enrichment failures", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(enrichMovieFromTmdb).mockRejectedValueOnce(new Error("omdb timeout"));

    scheduleMovieImportEnrichment(99);
    await vi.waitFor(() => {
      expect(errSpy).toHaveBeenCalled();
    });

    errSpy.mockRestore();
  });

  it("drains ids queued while a prior enrichment is still running", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    vi.mocked(enrichMovieFromTmdb)
      .mockImplementationOnce(async () => {
        await firstGate;
      })
      .mockResolvedValueOnce(undefined);

    scheduleMovieImportEnrichment(1);
    await vi.waitFor(() => {
      expect(enrichMovieFromTmdb).toHaveBeenCalledWith(1);
    });

    scheduleMovieImportEnrichment(2);
    releaseFirst();

    await vi.waitFor(() => {
      expect(enrichMovieFromTmdb).toHaveBeenCalledWith(2);
    });
  });
});
