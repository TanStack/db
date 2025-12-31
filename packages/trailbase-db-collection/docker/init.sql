-- E2E Test Tables for TrailBase
-- Requirements: STRICT mode + INTEGER or UUID primary key

CREATE TABLE "users_e2e" (
  "id" INTEGER PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "age" INTEGER NOT NULL,
  "is_active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "metadata" TEXT,
  "deleted_at" TEXT
) STRICT;

CREATE TABLE "posts_e2e" (
  "id" INTEGER PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "large_view_count" TEXT NOT NULL,
  "published_at" TEXT,
  "deleted_at" TEXT
) STRICT;

CREATE TABLE "comments_e2e" (
  "id" INTEGER PRIMARY KEY,
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT
) STRICT;
