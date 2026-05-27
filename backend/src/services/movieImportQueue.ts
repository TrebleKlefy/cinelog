import { enrichMovieFromTmdb } from "./movieImportTmdb.js";

const pending = new Set<number>();
const queue: number[] = [];
let processing = false;

/** Run cast, OMDb, and other slow import steps after the HTTP response is sent. */
export function scheduleMovieImportEnrichment(tmdbId: number): void {
  if (pending.has(tmdbId)) return;
  pending.add(tmdbId);
  queue.push(tmdbId);
  void drain();
}

async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const tmdbId = queue.shift()!;
      try {
        await enrichMovieFromTmdb(tmdbId);
      } catch (e) {
        console.error(`Background TMDB import enrichment failed for ${tmdbId}:`, e);
      } finally {
        pending.delete(tmdbId);
      }
    }
  } finally {
    processing = false;
    if (queue.length > 0) void drain();
  }
}

/** Test helper — clears queued work between specs. */
export function resetMovieImportQueueForTests(): void {
  pending.clear();
  queue.length = 0;
  processing = false;
}
