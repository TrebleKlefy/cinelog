import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { importMovieFromTmdb } from "../src/services/movieImportTmdb.js";

/** Re-run TMDB import for catalog rows so OMDb IMDb + Rotten Tomatoes ratings are stored. */
async function main() {
  if (!process.env.OMDB_API_KEY?.trim()) {
    console.error("OMDB_API_KEY is not set — add it to backend/.env first.");
    process.exit(1);
  }

  const movies = await prisma.movie.findMany({
    where: { tmdbId: { not: null } },
    select: { id: true, title: true, tmdbId: true },
    orderBy: { title: "asc" },
  });

  if (movies.length === 0) {
    console.log("No TMDB-linked movies in catalog to refresh.");
    return;
  }

  console.log(`Refreshing OMDb ratings for ${movies.length} movie(s)…`);

  let ok = 0;
  let failed = 0;
  for (const m of movies) {
    try {
      await importMovieFromTmdb(m.tmdbId!);
      ok += 1;
      console.log(`  ✓ ${m.title}`);
    } catch (e) {
      failed += 1;
      console.warn(`  ✗ ${m.title}: ${(e as Error).message}`);
    }
  }

  const rtCount = await prisma.movieExternalRating.count({ where: { source: "ROTTEN_TOMATOES" } });
  console.log(`Done. ${ok} refreshed, ${failed} failed. Rotten Tomatoes rows in DB: ${rtCount}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
