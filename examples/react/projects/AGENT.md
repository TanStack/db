# TanStack Start + DB Projects Example

This is a TanStack Start project with tRPC API running on Start's server functions so it's easily deployable to many hosting platforms.

All reads from the Postgres database are done via tRPC queries which populate TanStack DB query collections.

We sync normalized data from tables into TanStack DB collections in the client & then write client-side queries for displaying data in components.

## Initial setup

Before you started, all necessary package install is done via `pnpm install` and a dev server is started with `pnpm dev`.

## Linting and formatting

Human devs have IDEs that autoformat code on every file save. After you edit files, you must do the equivalent by running `pnpm lint`.

This command will also report linter errors that were not automatically fixable. Use your judgement as to which of the linter violations should be fixed.

## Build/Test Commands

- `pnpm run dev` - Start development server with Docker services
- `pnpm run build` - Build for production
- `pnpm run test` - Run all Vitest tests
- `vitest run <test-file>` - Run single test file
- `pnpm run start` - Start production server

## Architecture

- **Frontend**: TanStack Start (SSR framework for React and other frameworks) with file-based routing in `src/routes/`
- **Database**: PostgreSQL with Drizzle ORM, schema in `src/db/schema.ts`
- **Services**: Docker Compose setup (Postgres on 54321)
- **Styling**: Tailwind CSS v4
- **Authentication**: better-auth
- **API**: tRPC for full e2e typesafety.

## Code Style

- **TypeScript**: Strict mode, ES2022 target, bundler module resolution
- **Imports**: Use `@/*` path aliases for `src/` directory imports
- **Components**: React 19 with JSX transform, functional components preferred
- **Server DB**: Drizzle ORM with PostgreSQL dialect, schema-first approach
- **Client DB**: TanStack DB with Query Collections
- **Routing**: File-based with TanStack Router, use `Link` component for navigation
- **Testing**: Vitest with @testing-library/react for component tests
- **file names** should always use kebab-case
