import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Demo seed titles removed from the product — purge on every seed run. */
const REMOVED_SEED_MOVIE_IDS = [
  "seed-movie-inception",
  "seed-movie-matrix",
  "seed-movie-interstellar",
] as const;

const REMOVED_DEMO_TITLES = ["Inception", "The Matrix", "Interstellar"] as const;

async function purgeRemovedDemoMovies(): Promise<number> {
  const byId = await prisma.movie.deleteMany({
    where: { id: { in: [...REMOVED_SEED_MOVIE_IDS] } },
  });

  const byTitle = await prisma.movie.deleteMany({
    where: {
      title: { in: [...REMOVED_DEMO_TITLES], mode: "insensitive" },
    },
  });

  return byId.count + byTitle.count;
}

async function main() {
  const purged = await purgeRemovedDemoMovies();
  if (purged > 0) {
    console.log(`Purged ${purged} demo movie row(s) (Inception, The Matrix, Interstellar).`);
  }

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

  await prisma.llmModel.upsert({
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

  await Promise.all([
    prisma.genre.upsert({ where: { name: "Sci-Fi" }, update: {}, create: { name: "Sci-Fi" } }),
    prisma.genre.upsert({ where: { name: "Thriller" }, update: {}, create: { name: "Thriller" } }),
    prisma.genre.upsert({ where: { name: "Drama" }, update: {}, create: { name: "Drama" } }),
    prisma.genre.upsert({ where: { name: "Action" }, update: {}, create: { name: "Action" } }),
  ]);

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

  await prisma.userCollection.upsert({
    where: { slug: "admin" },
    update: {},
    create: {
      userId: admin.id,
      slug: "admin",
      title: "Admin Collection",
      isPublic: false,
    },
  });

  console.log("Seed complete. Users: admin@demo.com / Admin123!, user@demo.com / User123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
