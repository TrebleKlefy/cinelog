-- Explicit catalog removals per user (hides imports from scoped catalog without deleting shared Movie rows).

CREATE TABLE "user_hidden_movies" (
    "user_id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_hidden_movies_pkey" PRIMARY KEY ("user_id","movie_id")
);

ALTER TABLE "user_hidden_movies" ADD CONSTRAINT "user_hidden_movies_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_hidden_movies" ADD CONSTRAINT "user_hidden_movies_movie_id_fkey"
  FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
