-- E2E Test Tables for TrailBase
-- Using BLOB UUID PRIMARY KEY with auto-generated uuid_v7()
-- Using is_uuid() check to accept both v4 and v7 UUIDs
-- Using camelCase column names to match @tanstack/db-collection-e2e types

CREATE TABLE "users_e2e" (
  "id" BLOB PRIMARY KEY NOT NULL CHECK(is_uuid(id)) DEFAULT (uuid_v7()),
  "name" TEXT NOT NULL,
  "email" TEXT,
  "age" INTEGER NOT NULL,
  "isActive" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL,
  "metadata" TEXT,
  "deletedAt" TEXT
) STRICT;

CREATE TABLE "posts_e2e" (
  "id" BLOB PRIMARY KEY NOT NULL CHECK(is_uuid(id)) DEFAULT (uuid_v7()),
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "largeViewCount" TEXT NOT NULL,
  "publishedAt" TEXT,
  "deletedAt" TEXT
) STRICT;

CREATE TABLE "comments_e2e" (
  "id" BLOB PRIMARY KEY NOT NULL CHECK(is_uuid(id)) DEFAULT (uuid_v7()),
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "deletedAt" TEXT
) STRICT;
