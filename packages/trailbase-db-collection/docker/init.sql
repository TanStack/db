-- E2E Test Tables for TrailBase
-- Using BLOB UUID PRIMARY KEY with auto-generated uuid_v7()
-- Using is_uuid() check to accept both v4 and v7 UUIDs

CREATE TABLE "users_e2e" (
  "id" BLOB PRIMARY KEY NOT NULL CHECK(is_uuid(id)) DEFAULT (uuid_v7()),
  "name" TEXT NOT NULL,
  "email" TEXT,
  "age" INTEGER NOT NULL,
  "is_active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "metadata" TEXT,
  "deleted_at" TEXT
) STRICT;

CREATE TABLE "posts_e2e" (
  "id" BLOB PRIMARY KEY NOT NULL CHECK(is_uuid(id)) DEFAULT (uuid_v7()),
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "large_view_count" TEXT NOT NULL,
  "published_at" TEXT,
  "deleted_at" TEXT
) STRICT;

CREATE TABLE "comments_e2e" (
  "id" BLOB PRIMARY KEY NOT NULL CHECK(is_uuid(id)) DEFAULT (uuid_v7()),
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT
) STRICT;
