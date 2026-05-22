-- AlterEnum
ALTER TYPE "ExternalRatingSource" ADD VALUE 'TMDB';

-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'MOVIE_IMPORT_TMDB';

-- AlterTable
ALTER TABLE "movies" ADD COLUMN "tmdb_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "movies_tmdb_id_key" ON "movies"("tmdb_id");
