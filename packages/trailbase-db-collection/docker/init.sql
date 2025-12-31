-- E2E Test Tables for TrailBase
-- Using BLOB for UUIDs with uuid_v7() default, INTEGER for timestamps/booleans

CREATE TABLE "users_e2e" (
  "id" BLOB PRIMARY KEY DEFAULT (uuid_v7()),
  "name" TEXT NOT NULL,
  "email" TEXT,
  "age" INTEGER NOT NULL,
  "is_active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "metadata" TEXT,
  "deleted_at" TEXT
);

CREATE TABLE "posts_e2e" (
  "id" BLOB PRIMARY KEY DEFAULT (uuid_v7()),
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "large_view_count" TEXT NOT NULL,
  "published_at" TEXT,
  "deleted_at" TEXT
);

CREATE TABLE "comments_e2e" (
  "id" BLOB PRIMARY KEY DEFAULT (uuid_v7()),
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT
);
