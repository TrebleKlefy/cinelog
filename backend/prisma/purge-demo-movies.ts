import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REMOVED_SEED_MOVIE_IDS = [
  "seed-movie-inception",
  "seed-movie-matrix",
  "seed-movie-interstellar",
] as const;

const REMOVED_DEMO_TITLES = ["Inception", "The Matrix", "Interstellar"] as const;

async function main() {
  const remaining = await prisma.movie.findMany({
    where: {
      OR: [{ id: { in: [...REMOVED_SEED_MOVIE_IDS] } }, { title: { in: [...REMOVED_DEMO_TITLES], mode: "insensitive" } }],
    },
    select: { id: true, title: true, releaseYear: true },
  });

  if (remaining.length === 0) {
    console.log("No Inception / The Matrix / Interstellar rows found.");
    return;
  }

  console.log("Removing:", remaining.map((m) => `${m.title} (${m.releaseYear}) [${m.id}]`).join(", "));

  const byId = await prisma.movie.deleteMany({
    where: { id: { in: [...REMOVED_SEED_MOVIE_IDS] } },
  });
  const byTitle = await prisma.movie.deleteMany({
    where: { title: { in: [...REMOVED_DEMO_TITLES], mode: "insensitive" } },
  });

  console.log(`Deleted ${byId.count + byTitle.count} movie row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
