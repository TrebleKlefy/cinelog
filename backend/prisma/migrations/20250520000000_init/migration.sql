-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

CREATE TYPE "ExternalRatingSource" AS ENUM ('IMDB', 'ROTTEN_TOMATOES');

CREATE TYPE "AuditActionType" AS ENUM (
  'AUTH_LOGIN',
  'AUTH_LOGOUT',
  'COLLECTION_ADD_MOVIE',
  'COLLECTION_REMOVE_MOVIE',
  'RATING_SUBMIT',
  'SEARCH_STRUCTURED',
  'SEARCH_AI_NATURAL_LANGUAGE',
  'AI_RECOMMENDATION_REQUEST',
  'ADMIN_LLM_PROVIDER_CHANGED',
  'ADMIN_LLM_MODEL_CHANGED'
);

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "movies" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "release_year" INTEGER NOT NULL,
    "runtime_minutes" INTEGER,
    "synopsis" TEXT,
    "poster_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "genres" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

CREATE TABLE "movie_cast" (
    "id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "character_name" TEXT,
    CONSTRAINT "movie_cast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "movie_cast_movie_id_person_id_character_name_key" ON "movie_cast"("movie_id", "person_id", "character_name");

CREATE TABLE "movie_directors" (
    "movie_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    CONSTRAINT "movie_directors_pkey" PRIMARY KEY ("movie_id","person_id")
);

CREATE TABLE "movie_genres" (
    "movie_id" TEXT NOT NULL,
    "genre_id" TEXT NOT NULL,
    CONSTRAINT "movie_genres_pkey" PRIMARY KEY ("movie_id","genre_id")
);

CREATE TABLE "movie_external_ratings" (
    "id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "source" "ExternalRatingSource" NOT NULL,
    "rating_value" DOUBLE PRECISION NOT NULL,
    "rating_scale" INTEGER NOT NULL,
    "rating_raw" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "movie_external_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "movie_external_ratings_movie_id_source_key" ON "movie_external_ratings"("movie_id", "source");

CREATE TABLE "user_collections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_collections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_collections_slug_key" ON "user_collections"("slug");

CREATE TABLE "collection_movies" (
    "collection_id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "collection_movies_pkey" PRIMARY KEY ("collection_id","movie_id")
);

CREATE TABLE "user_movie_ratings" (
    "user_id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_movie_ratings_pkey" PRIMARY KEY ("user_id","movie_id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_type" "AuditActionType" NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "resource_label" TEXT,
    "metadata" JSONB,
    "created_at_utc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_user_id_created_at_utc_idx" ON "audit_logs"("user_id", "created_at_utc");

CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reviews_movie_id_idx" ON "reviews"("movie_id");

CREATE TABLE "llm_providers" (
    "id" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "llm_providers_provider_key_key" ON "llm_providers"("provider_key");

CREATE TABLE "llm_models" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "input_cost_per_1m_tokens" DOUBLE PRECISION,
    "output_cost_per_1m_tokens" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "llm_models_provider_id_model_key_key" ON "llm_models"("provider_id", "model_key");

CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "active_llm_provider_id" TEXT NOT NULL,
    "active_llm_model_id" TEXT NOT NULL,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "movie_cast" ADD CONSTRAINT "movie_cast_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_cast" ADD CONSTRAINT "movie_cast_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_directors" ADD CONSTRAINT "movie_directors_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_directors" ADD CONSTRAINT "movie_directors_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_external_ratings" ADD CONSTRAINT "movie_external_ratings_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_collections" ADD CONSTRAINT "user_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_movies" ADD CONSTRAINT "collection_movies_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "user_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_movies" ADD CONSTRAINT "collection_movies_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_movie_ratings" ADD CONSTRAINT "user_movie_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_movie_ratings" ADD CONSTRAINT "user_movie_ratings_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "llm_models" ADD CONSTRAINT "llm_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "llm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_active_llm_provider_id_fkey" FOREIGN KEY ("active_llm_provider_id") REFERENCES "llm_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_active_llm_model_id_fkey" FOREIGN KEY ("active_llm_model_id") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
