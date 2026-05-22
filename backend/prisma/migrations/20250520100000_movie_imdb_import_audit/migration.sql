-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'MOVIE_IMPORT_OMDB';

-- AlterTable
ALTER TABLE "movies" ADD COLUMN "imdb_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "movies_imdb_id_key" ON "movies"("imdb_id");
