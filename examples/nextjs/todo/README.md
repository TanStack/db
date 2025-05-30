# Todo Example App - Next.js

A todo application built with Next.js 15 (App Router), TanStack DB, and TypeScript.

## Features

- **Next.js 15** with App Router
- **TanStack DB** with both Electric and Query collections
- **Real-time updates** with Electric SQL
- **Optimistic mutations** for instant UI feedback
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **PostgreSQL** database with Drizzle ORM

## How to run

- Go to the root of the repository and run:

  - `pnpm install`
  - `pnpm build`

- Install packages
  `pnpm install`

- Start dev server & Docker containers
  `pnpm dev`

- Run db migrations
  `pnpm db:push`

## Architecture

This example demonstrates the same functionality as the React version but using Next.js App Router:

- **App Router**: Uses the latest Next.js app directory structure
- **Client Components**: The main todo interface is a client component for interactivity
- **Server Components**: Layout and other components use server components where possible
- **API Routes**: Express server runs separately for database operations
- **Real-time sync**: Electric SQL provides real-time database synchronization

## Collection Types

The app supports two collection types:

1. **Query Collections**: Traditional API-based data fetching with polling
2. **Electric Collections**: Real-time streaming updates via Electric SQL

You can switch between collection types using the toggle in the UI to see the difference in behavior. 