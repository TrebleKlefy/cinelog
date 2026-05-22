import "dotenv/config";
import { PrismaClient, UserRole, ExternalRatingSource } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const openai = await prisma.llmProvider.upsert({
    where: { providerKey: "openai" },
    update: {},
    create: {
      providerKey: "openai",
      displayName: "OpenAI",
      isEnabled: true,
    },
  });

  const anthropic = await prisma.llmProvider.upsert({
    where: { providerKey: "anthropic" },
    update: {},
    create: {
      providerKey: "anthropic",
      displayName: "Anthropic",
      isEnabled: true,
    },
  });

  const groq = await prisma.llmProvider.upsert({
    where: { providerKey: "groq" },
    update: {},
    create: {
      providerKey: "groq",
      displayName: "Groq",
      isEnabled: true,
    },
  });

  const openaiModel = await prisma.llmModel.upsert({
    where: {
      providerId_modelKey: { providerId: openai.id, modelKey: "gpt-4o-mini" },
    },
    update: {},
    create: {
      providerId: openai.id,
      modelKey: "gpt-4o-mini",
      isEnabled: true,
      inputCostPer1mTokens: 0.15,
      outputCostPer1mTokens: 0.6,
    },
  });

  await prisma.llmModel.upsert({
    where: {
      providerId_modelKey: { providerId: anthropic.id, modelKey: "claude-3-5-haiku-latest" },
    },
    update: {},
    create: {
      providerId: anthropic.id,
      modelKey: "claude-3-5-haiku-latest",
      isEnabled: true,
    },
  });

  await prisma.llmModel.upsert({
    where: {
      providerId_modelKey: { providerId: groq.id, modelKey: "llama-3.1-8b-instant" },
    },
    update: {},
    create: {
      providerId: groq.id,
      modelKey: "llama-3.1-8b-instant",
      isEnabled: true,
    },
  });

  const groqLlamaScout = await prisma.llmModel.upsert({
    where: {
      providerId_modelKey: {
        providerId: groq.id,
        modelKey: "meta-llama/llama-4-scout-17b-16e-instruct",
      },
    },
    update: {},
    create: {
      providerId: groq.id,
      modelKey: "meta-llama/llama-4-scout-17b-16e-instruct",
      isEnabled: true,
    },
  });

  /** New installs default to Groq + Llama; re-running seed must not wipe admin's active LLM choice. */
  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      activeLlmProviderId: groq.id,
      activeLlmModelId: groqLlamaScout.id,
    },
  });

  const genres = await Promise.all([
    prisma.genre.upsert({ where: { name: "Sci-Fi" }, update: {}, create: { name: "Sci-Fi" } }),
    prisma.genre.upsert({ where: { name: "Thriller" }, update: {}, create: { name: "Thriller" } }),
    prisma.genre.upsert({ where: { name: "Drama" }, update: {}, create: { name: "Drama" } }),
    prisma.genre.upsert({ where: { name: "Action" }, update: {}, create: { name: "Action" } }),
  ]);

  const nolan = await prisma.person.upsert({
    where: { id: "seed-person-nolan" },
    update: {},
    create: { id: "seed-person-nolan", name: "Christopher Nolan" },
  });

  const reeves = await prisma.person.upsert({
    where: { id: "seed-person-reeves" },
    update: {},
    create: { id: "seed-person-reeves", name: "Keanu Reeves" },
  });

  const moss = await prisma.person.upsert({
    where: { id: "seed-person-moss" },
    update: {},
    create: { id: "seed-person-moss", name: "Carrie-Anne Moss" },
  });

  const m1 = await prisma.movie.upsert({
    where: { id: "seed-movie-inception" },
    update: {},
    create: {
      id: "seed-movie-inception",
      title: "Inception",
      releaseYear: 2010,
      runtimeMinutes: 148,
      synopsis: "A thief who steals corporate secrets through dream-sharing technology is offered a chance at redemption.",
      posterUrl: null,
    },
  });

  const m2 = await prisma.movie.upsert({
    where: { id: "seed-movie-matrix" },
    update: {},
    create: {
      id: "seed-movie-matrix",
      title: "The Matrix",
      releaseYear: 1999,
      runtimeMinutes: 136,
      synopsis: "A computer hacker learns about the true nature of reality and his role in the war against its controllers.",
      posterUrl: null,
    },
  });

  const m3 = await prisma.movie.upsert({
    where: { id: "seed-movie-interstellar" },
    update: {},
    create: {
      id: "seed-movie-interstellar",
      title: "Interstellar",
      releaseYear: 2014,
      runtimeMinutes: 169,
      synopsis: "Explorers travel through a wormhole in space to ensure humanity's survival.",
      posterUrl: null,
    },
  });

  await prisma.movieDirector.upsert({
    where: { movieId_personId: { movieId: m1.id, personId: nolan.id } },
    update: {},
    create: { movieId: m1.id, personId: nolan.id },
  });
  await prisma.movieDirector.upsert({
    where: { movieId_personId: { movieId: m3.id, personId: nolan.id } },
    update: {},
    create: { movieId: m3.id, personId: nolan.id },
  });

  await prisma.movieCast.createMany({
    data: [
      { movieId: m2.id, personId: reeves.id, characterName: "Neo" },
      { movieId: m2.id, personId: moss.id, characterName: "Trinity" },
    ],
    skipDuplicates: true,
  });

  const sciFi = genres.find((g) => g.name === "Sci-Fi")!;
  const action = genres.find((g) => g.name === "Action")!;
  const drama = genres.find((g) => g.name === "Drama")!;

  await prisma.movieGenre.createMany({
    data: [
      { movieId: m1.id, genreId: sciFi.id },
      { movieId: m1.id, genreId: action.id },
      { movieId: m2.id, genreId: sciFi.id },
      { movieId: m2.id, genreId: action.id },
      { movieId: m3.id, genreId: sciFi.id },
      { movieId: m3.id, genreId: drama.id },
    ],
    skipDuplicates: true,
  });

  for (const [movieId, imdb, rt] of [
    [m1.id, { v: 8.8, raw: "8.8/10" }, { v: 87, raw: "87%" }],
    [m2.id, { v: 8.7, raw: "8.7/10" }, { v: 83, raw: "83%" }],
    [m3.id, { v: 8.7, raw: "8.7/10" }, { v: 72, raw: "72%" }],
  ] as const) {
    await prisma.movieExternalRating.upsert({
      where: { movieId_source: { movieId, source: ExternalRatingSource.IMDB } },
      update: { ratingValue: imdb.v, ratingScale: 10, ratingRaw: imdb.raw },
      create: {
        movieId,
        source: ExternalRatingSource.IMDB,
        ratingValue: imdb.v,
        ratingScale: 10,
        ratingRaw: imdb.raw,
      },
    });
    await prisma.movieExternalRating.upsert({
      where: { movieId_source: { movieId, source: ExternalRatingSource.ROTTEN_TOMATOES } },
      update: { ratingValue: rt.v, ratingScale: 100, ratingRaw: rt.raw },
      create: {
        movieId,
        source: ExternalRatingSource.ROTTEN_TOMATOES,
        ratingValue: rt.v,
        ratingScale: 100,
        ratingRaw: rt.raw,
      },
    });
  }

  const adminPass = await bcrypt.hash("Admin123!", 10);
  const userPass = await bcrypt.hash("User123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@demo.com" },
    update: {},
    create: {
      email: "admin@demo.com",
      passwordHash: adminPass,
      displayName: "Admin",
      role: UserRole.ADMIN,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "user@demo.com" },
    update: {},
    create: {
      email: "user@demo.com",
      passwordHash: userPass,
      displayName: "Demo User",
      role: UserRole.USER,
    },
  });

  await prisma.userCollection.upsert({
    where: { slug: "demo-user" },
    update: {},
    create: {
      userId: user.id,
      slug: "demo-user",
      title: "Demo User's Watched",
      isPublic: true,
    },
  });

  const adminCollection = await prisma.userCollection.upsert({
    where: { slug: "admin" },
    update: {},
    create: {
      userId: admin.id,
      slug: "admin",
      title: "Admin Collection",
      isPublic: false,
    },
  });

  const demoColl = await prisma.userCollection.findFirst({ where: { userId: user.id } });
  if (demoColl) {
    await prisma.collectionMovie.upsert({
      where: {
        collectionId_movieId: { collectionId: demoColl.id, movieId: m2.id },
      },
      update: {},
      create: { collectionId: demoColl.id, movieId: m2.id },
    });
  }

  console.log("Seed complete. Users: admin@demo.com / Admin123!, user@demo.com / User123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
