# LinearLite Port to TanStack Start + TanStack DB - Detailed Plan

## Executive Summary

This document outlines a comprehensive plan to port the [LinearLite example](https://github.com/electric-sql/electric/tree/main/examples/linearlite) from Electric SQL + PGlite to **TanStack Start + TanStack DB**. The ported application will support **dual modes** (Query mode and Electric mode) to demonstrate both traditional polling and real-time sync approaches.

### Key Objectives

1. **Full feature parity** with original LinearLite (issue management, kanban board, comments, filtering, etc.)
2. **Dual-mode architecture** allowing users to switch between Query and Electric modes
3. **User isolation** - users can only see pre-created data + their own created data
4. **Modern stack** - TanStack Start for full-stack framework, TanStack DB for client-side data store
5. **Type-safe** end-to-end with schemas and validation

---

## Architecture Overview

### Technology Stack

#### **Frontend**
- **Framework:** TanStack React Start (v1.x)
- **Data Store:** TanStack DB (v0.4.x)
- **Styling:** Tailwind CSS
- **Rich Text Editor:** TipTap with markdown support
- **Drag & Drop:** @dnd-kit (modern alternative to react-beautiful-dnd)
- **Virtualization:** @tanstack/react-virtual (modern alternative to react-window)

#### **Backend**
- **Server Framework:** TanStack Start server functions + tRPC
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Schema Validation:** Zod
- **Authentication:** Better Auth
- **Real-time Sync:** ElectricSQL v0.13+

#### **Build Tools**
- **Bundler:** Vite
- **Package Manager:** pnpm
- **Language:** TypeScript 5.x

### Dual-Mode Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TanStack Start App                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │          React Components (useLiveQuery)              │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │           TanStack DB Collections Layer               │  │
│  │  ┌──────────────────┐  ┌──────────────────┐          │  │
│  │  │ Query Collection │  │Electric Collection│          │  │
│  │  │  (Poll mode)     │  │  (Real-time mode)│          │  │
│  │  └────────┬─────────┘  └────────┬─────────┘          │  │
│  └───────────┼─────────────────────┼────────────────────┘  │
│              │                     │                        │
│  ┌───────────▼─────────┐  ┌────────▼──────────┐           │
│  │   tRPC API Routes   │  │ Electric Proxy    │           │
│  │   (Server Fns)      │  │   Route           │           │
│  └───────────┬─────────┘  └────────┬──────────┘           │
│              │                     │                        │
└──────────────┼─────────────────────┼────────────────────────┘
               │                     │
          ┌────▼─────────────────────▼─────┐
          │      PostgreSQL Database       │
          │  ┌──────────────────────────┐  │
          │  │ issues, comments, users  │  │
          │  └──────────────────────────┘  │
          └────────────────────────────────┘
                     ▲
                     │
          ┌──────────▼──────────┐
          │  ElectricSQL Sync   │
          │      Service        │
          └─────────────────────┘
```

---

## Phase 1: Project Setup & Infrastructure

### 1.1 Initialize TanStack Start Project

```bash
# Create new TanStack Start project
npx create-start@latest linearlite-tanstack --template react

# Navigate to project
cd linearlite-tanstack

# Initialize pnpm (if not already)
pnpm install
```

### 1.2 Install Dependencies

```bash
# Core dependencies
pnpm add @tanstack/react-db @tanstack/db
pnpm add @tanstack/query-db-collection
pnpm add @tanstack/electric-db-collection
pnpm add @tanstack/react-router
pnpm add @tanstack/react-query
pnpm add @trpc/server @trpc/client @trpc/react-query

# Database & ORM
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit

# Schema validation
pnpm add zod drizzle-zod

# Authentication
pnpm add better-auth

# ElectricSQL
pnpm add @electric-sql/client

# UI libraries
pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-table tiptap-markdown
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
pnpm add fractional-indexing
pnpm add clsx tailwind-merge
pnpm add lucide-react

# Virtualization
pnpm add @tanstack/react-virtual

# Dev dependencies
pnpm add -D tailwindcss postcss autoprefixer
pnpm add -D @types/node
```

### 1.3 Configure Tailwind CSS

**tailwind.config.ts:**
```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        border: 'var(--border)',
        primary: 'var(--primary)',
      },
    },
  },
  plugins: [],
} satisfies Config
```

### 1.4 Configure Environment Variables

**.env:**
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/linearlite

# ElectricSQL
ELECTRIC_URL=http://localhost:3000/v1/shape
ELECTRIC_API_URL=http://localhost:3000

# Auth
BETTER_AUTH_SECRET=your-secret-key-here
BETTER_AUTH_URL=http://localhost:3001

# Mode
NODE_ENV=development
```

---

## Phase 2: Database Schema & Migrations

### 2.1 Define Drizzle Schema

**src/db/schema.ts:**
```typescript
import { pgTable, text, timestamp, uuid, boolean, pgEnum } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

// Enums
export const priorityEnum = pgEnum('priority', ['none', 'urgent', 'high', 'medium', 'low'])
export const statusEnum = pgEnum('status', ['backlog', 'todo', 'in_progress', 'done', 'canceled'])

// Users table
export const usersTable = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  username: text().notNull().unique(),
  email: text().notNull().unique(),
  name: text(),
  avatar_url: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// Issues table
export const issuesTable = pgTable('issues', {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  description: text().default(''),
  priority: priorityEnum().notNull().default('none'),
  status: statusEnum().notNull().default('backlog'),
  kanbanorder: text().notNull(),
  user_id: uuid().notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  modified: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// Comments table
export const commentsTable = pgTable('comments', {
  id: uuid().primaryKey().defaultRandom(),
  body: text().notNull(),
  user_id: uuid().notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  issue_id: uuid().notNull().references(() => issuesTable.id, { onDelete: 'cascade' }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  modified: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// Zod schemas for validation
export const selectUserSchema = createSelectSchema(usersTable)
export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
})

export const selectIssueSchema = createSelectSchema(issuesTable)
export const insertIssueSchema = createInsertSchema(issuesTable).omit({
  id: true,
  created_at: true,
  modified: true,
})

export const selectCommentSchema = createSelectSchema(commentsTable)
export const insertCommentSchema = createInsertSchema(commentsTable).omit({
  id: true,
  created_at: true,
  modified: true,
})

// TypeScript types
export type User = typeof usersTable.$inferSelect
export type InsertUser = typeof usersTable.$inferInsert
export type Issue = typeof issuesTable.$inferSelect
export type InsertIssue = typeof issuesTable.$inferInsert
export type Comment = typeof commentsTable.$inferSelect
export type InsertComment = typeof commentsTable.$inferInsert

export type Priority = 'none' | 'urgent' | 'high' | 'medium' | 'low'
export type Status = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'
```

### 2.2 Database Connection

**src/db/connection.ts:**
```typescript
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set')
}

export const db = drizzle(process.env.DATABASE_URL, {
  schema,
  casing: 'snake_case',
})
```

### 2.3 Seed Data Script

**src/db/seed.ts:**
```typescript
import { db } from './connection'
import { usersTable, issuesTable, commentsTable } from './schema'
import { generateKeyBetween } from 'fractional-indexing'

async function seed() {
  console.log('Seeding database...')

  // Create demo users
  const [demoUser] = await db.insert(usersTable).values({
    username: 'demo',
    email: 'demo@example.com',
    name: 'Demo User',
  }).returning()

  const [testUser] = await db.insert(usersTable).values({
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
  }).returning()

  console.log('Created users:', demoUser.username, testUser.username)

  // Create demo issues
  let kanbanorder = generateKeyBetween(null, null)

  const issues = [
    {
      title: 'Set up project infrastructure',
      description: 'Initialize TanStack Start project with all dependencies',
      priority: 'high' as const,
      status: 'done' as const,
      user_id: demoUser.id,
      kanbanorder,
    },
    {
      title: 'Implement issue list view',
      description: 'Create the main issue list with filtering and sorting',
      priority: 'high' as const,
      status: 'in_progress' as const,
      user_id: demoUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Add kanban board',
      description: 'Implement drag-and-drop kanban board for issues',
      priority: 'medium' as const,
      status: 'todo' as const,
      user_id: demoUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Build comment system',
      description: 'Allow users to comment on issues',
      priority: 'medium' as const,
      status: 'backlog' as const,
      user_id: testUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
  ]

  const createdIssues = await db.insert(issuesTable).values(issues).returning()
  console.log(`Created ${createdIssues.length} issues`)

  // Create demo comments
  const comments = [
    {
      body: 'Great progress on this!',
      user_id: testUser.id,
      issue_id: createdIssues[0].id,
    },
    {
      body: 'Let me know if you need any help.',
      user_id: demoUser.id,
      issue_id: createdIssues[1].id,
    },
  ]

  await db.insert(commentsTable).values(comments)
  console.log(`Created ${comments.length} comments`)

  console.log('Seeding complete!')
}

seed().catch(console.error)
```

### 2.4 Drizzle Configuration

**drizzle.config.ts:**
```typescript
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
```

---

## Phase 3: Authentication Setup

### 3.1 Better Auth Configuration

**src/lib/auth.ts:**
```typescript
import { betterAuth } from 'better-auth'
import { db } from '@/db/connection'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },
})

export type Session = typeof auth.$Infer.Session
```

**src/lib/auth-client.ts:**
```typescript
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL,
})

export const { useSession, signIn, signOut, signUp } = authClient
```

### 3.2 Auth Middleware

**src/middleware/auth.ts:**
```typescript
import { auth } from '@/lib/auth'
import type { NextFunction, Request, Response } from 'express'

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const session = await auth.api.getSession({ headers: req.headers })

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  req.session = session
  next()
}
```

---

## Phase 4: tRPC API Setup

### 4.1 tRPC Router Configuration

**src/server/trpc/index.ts:**
```typescript
import { initTRPC } from '@trpc/server'
import { db } from '@/db/connection'
import type { Session } from '@/lib/auth'

interface Context {
  db: typeof db
  session: Session | null
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use((opts) => {
  if (!opts.ctx.session) {
    throw new Error('Unauthorized')
  }
  return opts.next({
    ctx: {
      ...opts.ctx,
      session: opts.ctx.session,
    },
  })
})
```

### 4.2 Issues Router

**src/server/trpc/routers/issues.ts:**
```typescript
import { z } from 'zod'
import { router, protectedProcedure } from '../index'
import { issuesTable } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export const issuesRouter = router({
  getAll: protectedProcedure.query(async ({ ctx }) => {
    // Return only issues created by the user or pre-seeded demo data
    const issues = await ctx.db.query.issuesTable.findMany({
      where: (issues, { eq, or }) =>
        or(
          eq(issues.user_id, ctx.session.user.id),
          // Allow access to demo user's issues for all users
          eq(issues.user_id, 'demo-user-id-here')
        ),
      orderBy: (issues, { asc }) => [asc(issues.created_at)],
    })

    return issues
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().default(''),
        priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']),
        status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']),
        kanbanorder: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [issue] = await ctx.db
        .insert(issuesTable)
        .values({
          ...input,
          user_id: ctx.session.user.id,
        })
        .returning()

      return issue
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
        status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']).optional(),
        kanbanorder: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input

      // Verify ownership
      const existing = await ctx.db.query.issuesTable.findFirst({
        where: eq(issuesTable.id, id),
      })

      if (!existing || existing.user_id !== ctx.session.user.id) {
        throw new Error('Unauthorized')
      }

      const [updated] = await ctx.db
        .update(issuesTable)
        .set({
          ...updates,
          modified: new Date(),
        })
        .where(eq(issuesTable.id, id))
        .returning()

      return updated
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.query.issuesTable.findFirst({
        where: eq(issuesTable.id, input.id),
      })

      if (!existing || existing.user_id !== ctx.session.user.id) {
        throw new Error('Unauthorized')
      }

      await ctx.db.delete(issuesTable).where(eq(issuesTable.id, input.id))

      return { success: true }
    }),
})
```

### 4.3 Comments Router

**src/server/trpc/routers/comments.ts:**
```typescript
import { z } from 'zod'
import { router, protectedProcedure } from '../index'
import { commentsTable, issuesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const commentsRouter = router({
  getByIssueId: protectedProcedure
    .input(z.object({ issueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify user has access to this issue
      const issue = await ctx.db.query.issuesTable.findFirst({
        where: eq(issuesTable.id, input.issueId),
      })

      if (!issue) {
        throw new Error('Issue not found')
      }

      // User can see comments if they can see the issue
      if (issue.user_id !== ctx.session.user.id) {
        // Check if it's a demo issue
        const isDemoIssue = issue.user_id === 'demo-user-id'
        if (!isDemoIssue) {
          throw new Error('Unauthorized')
        }
      }

      return ctx.db.query.commentsTable.findMany({
        where: eq(commentsTable.issue_id, input.issueId),
        orderBy: (comments, { asc }) => [asc(comments.created_at)],
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        body: z.string().min(1),
        issue_id: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify user has access to this issue
      const issue = await ctx.db.query.issuesTable.findFirst({
        where: eq(issuesTable.id, input.issue_id),
      })

      if (!issue || issue.user_id !== ctx.session.user.id) {
        throw new Error('Unauthorized')
      }

      const [comment] = await ctx.db
        .insert(commentsTable)
        .values({
          ...input,
          user_id: ctx.session.user.id,
        })
        .returning()

      return comment
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.query.commentsTable.findFirst({
        where: eq(commentsTable.id, input.id),
      })

      if (!existing || existing.user_id !== ctx.session.user.id) {
        throw new Error('Unauthorized')
      }

      await ctx.db.delete(commentsTable).where(eq(commentsTable.id, input.id))

      return { success: true }
    }),
})
```

### 4.4 App Router

**src/server/trpc/router.ts:**
```typescript
import { router } from './index'
import { issuesRouter } from './routers/issues'
import { commentsRouter } from './routers/comments'

export const appRouter = router({
  issues: issuesRouter,
  comments: commentsRouter,
})

export type AppRouter = typeof appRouter
```

### 4.5 tRPC API Route Handler

**src/routes/api/trpc/$.ts:**
```typescript
import { createFileRoute } from '@tanstack/react-router'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/server/trpc/router'
import { db } from '@/db/connection'
import { auth } from '@/lib/auth'

const serve = async ({ request }: { request: Request }) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: appRouter,
    createContext: async () => ({
      db,
      session: await auth.api.getSession({ headers: request.headers }),
    }),
  })
}

export const ServerRoute = createFileRoute('/api/trpc/$').methods({
  GET: serve,
  POST: serve,
})
```

---

## Phase 5: TanStack DB Collections Setup

### 5.1 Create tRPC Client

**src/lib/trpc.ts:**
```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@/server/trpc/router'

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      headers: () => {
        return {
          'content-type': 'application/json',
        }
      },
    }),
  ],
})
```

### 5.2 Query Collection Configuration

**src/lib/collections/query-mode.ts:**
```typescript
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { selectIssueSchema, selectCommentSchema } from '@/db/schema'
import { trpc } from '@/lib/trpc'

export const queryClient = new QueryClient()

export const issuesQueryCollection = createCollection(
  queryCollectionOptions({
    id: 'issues-query',
    queryKey: ['issues'],
    refetchInterval: 3000, // Poll every 3 seconds
    queryClient,

    queryFn: async () => {
      const issues = await trpc.issues.getAll.query()
      return issues.map((issue) => ({
        ...issue,
        created_at: new Date(issue.created_at),
        modified: new Date(issue.modified),
      }))
    },

    getKey: (item) => item.id,
    schema: selectIssueSchema,

    onInsert: async ({ transaction }) => {
      const newIssue = transaction.mutations[0].modified
      await trpc.issues.create.mutate({
        title: newIssue.title,
        description: newIssue.description,
        priority: newIssue.priority,
        status: newIssue.status,
        kanbanorder: newIssue.kanbanorder,
      })
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          trpc.issues.update.mutate({
            id: mutation.original.id,
            ...mutation.changes,
          })
        )
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          trpc.issues.delete.mutate({ id: mutation.original.id })
        )
      )
    },
  })
)

export const commentsQueryCollection = createCollection(
  queryCollectionOptions({
    id: 'comments-query',
    queryKey: ['comments'],
    refetchInterval: 3000,
    queryClient,

    queryFn: async () => {
      // This will be filtered per-issue in components
      // For now, return empty array - comments loaded per issue
      return []
    },

    getKey: (item) => item.id,
    schema: selectCommentSchema,

    onInsert: async ({ transaction }) => {
      const newComment = transaction.mutations[0].modified
      await trpc.comments.create.mutate({
        body: newComment.body,
        issue_id: newComment.issue_id,
      })
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          trpc.comments.delete.mutate({ id: mutation.original.id })
        )
      )
    },
  })
)
```

### 5.3 Electric Collection Configuration

**src/lib/collections/electric-mode.ts:**
```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { selectIssueSchema, selectCommentSchema } from '@/db/schema'
import { trpc } from '@/lib/trpc'

const ELECTRIC_URL = import.meta.env.VITE_ELECTRIC_URL || 'http://localhost:3000'

export const issuesElectricCollection = createCollection(
  electricCollectionOptions({
    id: 'issues-electric',

    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: 'issues',
        // Filter in Electric shape to only include user's issues + demo issues
        // This requires setting up user context in Electric proxy
      },
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },

    getKey: (item) => item.id,
    schema: selectIssueSchema,

    onInsert: async ({ transaction }) => {
      const newIssue = transaction.mutations[0].modified
      const response = await trpc.issues.create.mutate({
        title: newIssue.title,
        description: newIssue.description,
        priority: newIssue.priority,
        status: newIssue.status,
        kanbanorder: newIssue.kanbanorder,
      })

      // Return transaction ID for Electric to wait for sync
      return { txid: response.txid }
    },

    onUpdate: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const response = await trpc.issues.update.mutate({
            id: mutation.original.id,
            ...mutation.changes,
          })
          return response.txid
        })
      )
      return { txid: txids }
    },

    onDelete: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const response = await trpc.issues.delete.mutate({
            id: mutation.original.id,
          })
          return response.txid
        })
      )
      return { txid: txids }
    },
  })
)

export const commentsElectricCollection = createCollection(
  electricCollectionOptions({
    id: 'comments-electric',

    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: 'comments',
      },
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },

    getKey: (item) => item.id,
    schema: selectCommentSchema,

    onInsert: async ({ transaction }) => {
      const newComment = transaction.mutations[0].modified
      const response = await trpc.comments.create.mutate({
        body: newComment.body,
        issue_id: newComment.issue_id,
      })
      return { txid: response.txid }
    },

    onDelete: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const response = await trpc.comments.delete.mutate({
            id: mutation.original.id,
          })
          return response.txid
        })
      )
      return { txid: txids }
    },
  })
)
```

### 5.4 Mode Switcher Context

**src/lib/mode-context.tsx:**
```typescript
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Collection } from '@tanstack/db'
import type { Issue, Comment } from '@/db/schema'
import {
  issuesQueryCollection,
  commentsQueryCollection,
} from './collections/query-mode'
import {
  issuesElectricCollection,
  commentsElectricCollection,
} from './collections/electric-mode'

export type SyncMode = 'query' | 'electric'

interface ModeContextValue {
  mode: SyncMode
  setMode: (mode: SyncMode) => void
  issuesCollection: Collection<Issue>
  commentsCollection: Collection<Comment>
}

const ModeContext = createContext<ModeContextValue | null>(null)

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SyncMode>('query')

  const issuesCollection =
    mode === 'query' ? issuesQueryCollection : issuesElectricCollection
  const commentsCollection =
    mode === 'query' ? commentsQueryCollection : commentsElectricCollection

  return (
    <ModeContext.Provider
      value={{ mode, setMode, issuesCollection, commentsCollection }}
    >
      {children}
    </ModeContext.Provider>
  )
}

export function useMode() {
  const context = useContext(ModeContext)
  if (!context) {
    throw new Error('useMode must be used within ModeProvider')
  }
  return context
}
```

---

## Phase 6: Route Structure

### 6.1 Root Route with Layout

**src/routes/__root.tsx:**
```typescript
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ModeProvider } from '@/lib/mode-context'
import '@/styles/globals.css'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <ModeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Outlet />
      </div>
    </ModeProvider>
  )
}
```

### 6.2 Authenticated Layout

**src/routes/_authenticated.tsx:**
```typescript
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.session()

    if (!session) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <div className="flex h-screen">
      <LeftMenu />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

### 6.3 Issue List Route

**src/routes/_authenticated/index.tsx:**
```typescript
import { createFileRoute } from '@tanstack/react-router'
import { IssueList } from '@/components/IssueList'
import { TopFilter } from '@/components/TopFilter'
import { useMode } from '@/lib/mode-context'

export const Route = createFileRoute('/_authenticated/')({
  component: IssueListPage,
  loader: async () => {
    // Preload collections
    const { issuesCollection } = useMode()
    await issuesCollection.preload()
    return null
  },
})

function IssueListPage() {
  return (
    <div className="flex flex-col h-full">
      <TopFilter />
      <IssueList />
    </div>
  )
}
```

### 6.4 Kanban Board Route

**src/routes/_authenticated/board.tsx:**
```typescript
import { createFileRoute } from '@tanstack/react-router'
import { IssueBoard } from '@/components/IssueBoard'
import { TopFilter } from '@/components/TopFilter'
import { useMode } from '@/lib/mode-context'

export const Route = createFileRoute('/_authenticated/board')({
  component: BoardPage,
  loader: async () => {
    const { issuesCollection } = useMode()
    await issuesCollection.preload()
    return null
  },
})

function BoardPage() {
  return (
    <div className="flex flex-col h-full">
      <TopFilter hideSort />
      <IssueBoard />
    </div>
  )
}
```

### 6.5 Issue Detail Route

**src/routes/_authenticated/issue/$issueId.tsx:**
```typescript
import { createFileRoute } from '@tanstack/react-router'
import { IssueDetail } from '@/components/IssueDetail'
import { useMode } from '@/lib/mode-context'

export const Route = createFileRoute('/_authenticated/issue/$issueId')({
  component: IssueDetailPage,
  loader: async () => {
    const { issuesCollection, commentsCollection } = useMode()
    await Promise.all([
      issuesCollection.preload(),
      commentsCollection.preload(),
    ])
    return null
  },
})

function IssueDetailPage() {
  const { issueId } = Route.useParams()
  return <IssueDetail issueId={issueId} />
}
```

### 6.6 Login Route

**src/routes/login.tsx:**
```typescript
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signIn } from '@/lib/auth-client'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    await signIn.email({
      email,
      password,
    })

    navigate({ to: '/' })
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <form onSubmit={handleSubmit} className="space-y-4 w-96">
        <h1 className="text-2xl font-bold">Login</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-2 border rounded"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2 border rounded"
        />
        <button
          type="submit"
          className="w-full px-4 py-2 bg-primary text-white rounded"
        >
          Sign In
        </button>
      </form>
    </div>
  )
}
```

---

## Phase 7: Core Components Implementation

### 7.1 LeftMenu Component

**src/components/LeftMenu.tsx:**
```typescript
import { Link } from '@tanstack/react-router'
import { useMode } from '@/lib/mode-context'
import { Home, List, LayoutGrid, Search, Settings } from 'lucide-react'

export function LeftMenu() {
  const { mode, setMode } = useMode()

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 p-4 flex flex-col">
      <div className="mb-8">
        <h1 className="text-xl font-bold">LinearLite</h1>
      </div>

      <nav className="flex-1 space-y-2">
        <Link
          to="/"
          className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-200"
          activeProps={{ className: 'bg-gray-200' }}
        >
          <Home size={18} />
          All Issues
        </Link>

        <Link
          to="/board"
          className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-200"
          activeProps={{ className: 'bg-gray-200' }}
        >
          <LayoutGrid size={18} />
          Board
        </Link>

        <Link
          to="/search"
          className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-200"
          activeProps={{ className: 'bg-gray-200' }}
        >
          <Search size={18} />
          Search
        </Link>
      </nav>

      <div className="mt-auto border-t pt-4">
        <div className="mb-2 text-sm font-medium text-gray-600">Sync Mode</div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('query')}
            className={`flex-1 px-3 py-2 rounded text-sm ${
              mode === 'query'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Query
          </button>
          <button
            onClick={() => setMode('electric')}
            className={`flex-1 px-3 py-2 rounded text-sm ${
              mode === 'electric'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Electric
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {mode === 'query' ? 'Polling every 3s' : 'Real-time sync'}
        </div>
      </div>
    </aside>
  )
}
```

### 7.2 TopFilter Component

**src/components/TopFilter.tsx:**
```typescript
import { useState } from 'react'
import { Filter, ChevronDown } from 'lucide-react'
import type { Priority, Status } from '@/db/schema'

interface TopFilterProps {
  hideSort?: boolean
}

export function TopFilter({ hideSort }: TopFilterProps) {
  const [selectedStatuses, setSelectedStatuses] = useState<Status[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([])

  return (
    <div className="border-b border-gray-200 p-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <button className="flex items-center gap-2 px-3 py-2 rounded border hover:bg-gray-50">
          <Filter size={16} />
          Filter
          <ChevronDown size={14} />
        </button>

        {selectedStatuses.map((status) => (
          <div
            key={status}
            className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm"
          >
            {status}
          </div>
        ))}

        {selectedPriorities.map((priority) => (
          <div
            key={priority}
            className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-sm"
          >
            {priority}
          </div>
        ))}
      </div>

      {!hideSort && (
        <select className="px-3 py-2 border rounded">
          <option>Sort by: Created</option>
          <option>Sort by: Modified</option>
          <option>Sort by: Priority</option>
          <option>Sort by: Status</option>
        </select>
      )}
    </div>
  )
}
```

### 7.3 IssueList Component

**src/components/IssueList.tsx:**
```typescript
import { useLiveQuery, eq } from '@tanstack/react-db'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { useMode } from '@/lib/mode-context'
import { IssueRow } from './IssueRow'

export function IssueList() {
  const { issuesCollection } = useMode()
  const parentRef = useRef<HTMLDivElement>(null)

  const { data: issues } = useLiveQuery((q) =>
    q
      .from({ issue: issuesCollection })
      .orderBy(({ issue }) => issue.created_at, 'desc')
  )

  const virtualizer = useVirtualizer({
    count: issues?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
  })

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const issue = issues[virtualItem.index]
          return (
            <div
              key={issue.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <IssueRow issue={issue} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### 7.4 IssueBoard Component

**src/components/IssueBoard.tsx:**
```typescript
import { useLiveQuery, eq } from '@tanstack/react-db'
import { useMode } from '@/lib/mode-context'
import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { generateKeyBetween } from 'fractional-indexing'
import { BoardColumn } from './BoardColumn'
import type { Status } from '@/db/schema'

const STATUSES: Status[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled']

export function IssueBoard() {
  const { issuesCollection } = useMode()

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor)
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const issueId = active.id as string
    const newStatus = over.id as Status

    // Update issue status and kanbanorder
    issuesCollection.update(issueId, (draft) => {
      draft.status = newStatus
      // Calculate new kanbanorder based on position
      draft.kanbanorder = generateKeyBetween(null, null)
    })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 p-4 overflow-x-auto h-full">
        {STATUSES.map((status) => (
          <BoardColumn key={status} status={status} />
        ))}
      </div>
    </DndContext>
  )
}
```

### 7.5 IssueDetail Component

**src/components/IssueDetail.tsx:**
```typescript
import { useLiveQuery, eq } from '@tanstack/react-db'
import { useMode } from '@/lib/mode-context'
import { useState, useEffect } from 'react'
import { Editor } from './editor/Editor'
import { Comments } from './Comments'
import { useDebounce } from '@/hooks/useDebounce'

interface IssueDetailProps {
  issueId: string
}

export function IssueDetail({ issueId }: IssueDetailProps) {
  const { issuesCollection } = useMode()

  const { data: issues } = useLiveQuery((q) =>
    q
      .from({ issue: issuesCollection })
      .where(({ issue }) => eq(issue.id, issueId))
  )

  const issue = issues?.[0]

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')

  const debouncedTitle = useDebounce(title, 500)
  const debouncedDescription = useDebounce(description, 500)

  useEffect(() => {
    if (!issue) return

    if (debouncedTitle !== issue.title) {
      issuesCollection.update(issue.id, (draft) => {
        draft.title = debouncedTitle
      })
    }
  }, [debouncedTitle])

  useEffect(() => {
    if (!issue) return

    if (debouncedDescription !== issue.description) {
      issuesCollection.update(issue.id, (draft) => {
        draft.description = debouncedDescription
      })
    }
  }, [debouncedDescription])

  if (!issue) {
    return <div>Issue not found</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-3xl font-bold w-full mb-4 border-none outline-none"
        placeholder="Issue title"
      />

      <div className="flex gap-4 mb-6">
        <select
          value={issue.status}
          onChange={(e) =>
            issuesCollection.update(issue.id, (draft) => {
              draft.status = e.target.value as any
            })
          }
          className="px-3 py-1 border rounded"
        >
          <option value="backlog">Backlog</option>
          <option value="todo">Todo</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="canceled">Canceled</option>
        </select>

        <select
          value={issue.priority}
          onChange={(e) =>
            issuesCollection.update(issue.id, (draft) => {
              draft.priority = e.target.value as any
            })
          }
          className="px-3 py-1 border rounded"
        >
          <option value="none">No Priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-2">Description</h3>
        <Editor
          content={description}
          onChange={setDescription}
        />
      </div>

      <Comments issueId={issue.id} />
    </div>
  )
}
```

---

## Phase 8: Additional Features

### 8.1 Full-Text Search

**Implementation approach:**
- Create a PostgreSQL GIN index on `tsvector` for issues
- Add tRPC endpoint for search
- Create search route with live query

### 8.2 Optimistic Updates Indicator

**Visual feedback for sync status:**
- Show "syncing" icon when mutations are pending
- Show "synced" icon when data is confirmed
- Handle errors with retry/rollback UI

### 8.3 Electric Proxy for User Filtering

**src/routes/api/electric/$.ts:**
```typescript
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/auth'

const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3000'

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(request.url)
  const electricUrl = new URL(`${ELECTRIC_URL}/v1/shape`)

  // Pass through Electric protocol parameters
  url.searchParams.forEach((value, key) => {
    electricUrl.searchParams.set(key, value)
  })

  // Add user filtering to WHERE clause
  const table = electricUrl.searchParams.get('table')
  const existingWhere = electricUrl.searchParams.get('where') || ''

  let userFilter = ''
  if (table === 'issues' || table === 'comments') {
    userFilter = `user_id = '${session.user.id}' OR user_id = 'demo-user-id'`
  }

  const newWhere = existingWhere
    ? `(${existingWhere}) AND (${userFilter})`
    : userFilter

  if (newWhere) {
    electricUrl.searchParams.set('where', newWhere)
  }

  const response = await fetch(electricUrl, {
    method: request.method,
    headers: request.headers,
  })

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}

export const ServerRoute = createFileRoute('/api/electric/$').methods({
  GET: serve,
})
```

---

## Phase 9: Testing Strategy

### 9.1 Unit Tests

- Test collection mutation handlers
- Test live query transformations
- Test utility functions (fractional indexing, etc.)

### 9.2 Integration Tests

- Test tRPC endpoints with mock database
- Test auth middleware
- Test Electric proxy filtering

### 9.3 E2E Tests (Playwright)

- Test issue creation flow
- Test mode switching
- Test real-time sync in Electric mode
- Test user isolation

---

## Phase 10: Deployment

### 10.1 Environment Setup

**Production environment variables:**
```bash
DATABASE_URL=postgresql://...
ELECTRIC_URL=https://electric.example.com
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://app.example.com
```

### 10.2 Build Configuration

**vite.config.ts:**
```typescript
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [
    tanstackStart({
      srcDirectory: 'src',
      start: { entry: './start.tsx' },
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### 10.3 Deployment Targets

**Options:**
- Vercel (recommended for TanStack Start)
- Cloudflare Pages
- AWS Amplify
- Self-hosted Node.js

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Project setup and dependencies
- [ ] Database schema and migrations
- [ ] Authentication setup
- [ ] Basic routing structure

### Week 2: Core Features
- [ ] tRPC API implementation
- [ ] Collection setup (Query + Electric modes)
- [ ] Issue list view
- [ ] Basic CRUD operations

### Week 3: Advanced Features
- [ ] Kanban board with drag-and-drop
- [ ] Issue detail page with rich editor
- [ ] Comments system
- [ ] Mode switcher

### Week 4: Polish & Testing
- [ ] Full-text search
- [ ] Filtering and sorting
- [ ] Optimistic update indicators
- [ ] E2E tests
- [ ] Deployment

---

## Key Differences from Original

### What's the Same
✅ Full issue management (CRUD)
✅ Kanban board with drag-and-drop
✅ Comments system
✅ Filtering and search
✅ Real-time updates (in Electric mode)
✅ Optimistic updates
✅ User-specific data

### What's Different
🔄 **Framework**: TanStack Start instead of vanilla React + React Router
🔄 **Data Layer**: TanStack DB instead of PGlite
🔄 **Backend**: tRPC + Drizzle instead of Hono write server
🔄 **Sync**: Dual-mode (Query polling + Electric real-time)
🔄 **Auth**: Better Auth instead of hardcoded username
🔄 **Virtualization**: @tanstack/react-virtual instead of react-window
🔄 **DnD**: @dnd-kit instead of react-beautiful-dnd

### What's New
✨ Mode switcher (Query vs Electric)
✨ Multi-user support with authentication
✨ User isolation (see only your data + demo data)
✨ Full-stack type safety with tRPC
✨ Modern TanStack ecosystem integration

---

## Success Criteria

1. ✅ **Feature Parity**: All LinearLite features work identically
2. ✅ **Dual Mode**: Users can switch between Query and Electric modes seamlessly
3. ✅ **User Isolation**: Users only see their data + pre-seeded demo data
4. ✅ **Performance**: Sub-100ms UI updates with optimistic mutations
5. ✅ **Type Safety**: End-to-end TypeScript with no `any` types
6. ✅ **Offline Support**: Works offline in Electric mode with sync on reconnect
7. ✅ **Production Ready**: Deployed and accessible with authentication

---

## Resources & References

### Documentation
- [TanStack Start Docs](https://tanstack.com/start)
- [TanStack DB Docs](https://tanstack.com/db)
- [ElectricSQL Docs](https://electric-sql.com)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [tRPC Docs](https://trpc.io)

### Example Code
- [Original LinearLite](https://github.com/electric-sql/electric/tree/main/examples/linearlite)
- [TanStack DB React Projects Example](/home/user/db/examples/react/projects/)
- [TanStack DB React Todo Example](/home/user/db/examples/react/todo/)

### Community
- [TanStack Discord](https://discord.gg/yjUNbvbraC)
- [ElectricSQL Discord](https://discord.electric-sql.com)

---

## Next Steps

1. **Review this plan** and provide feedback
2. **Set up development environment**
3. **Begin Phase 1 implementation**
4. **Iterate based on learnings**

This plan provides a comprehensive roadmap for porting LinearLite to the TanStack ecosystem while adding valuable enhancements like dual-mode sync and multi-user support.
