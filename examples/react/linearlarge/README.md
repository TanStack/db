# LinearLite - TanStack Start + TanStack DB Example

A modern issue tracker demonstrating the power of TanStack Start and TanStack DB. This example ports the original [LinearLite](https://github.com/electric-sql/electric/tree/main/examples/linearlite) from Electric SQL + PGlite to use TanStack's ecosystem.

## Features

- **Dual Sync Modes**: Toggle between Query (polling) and Electric (real-time) modes
- **Full CRUD**: Create, read, update, and delete issues and comments
- **Kanban Board**: Drag-and-drop interface with fractional indexing
- **Rich Text Editing**: TipTap editor with markdown support
- **Real-time Updates**: Automatic UI updates with TanStack DB's reactive queries
- **Optimistic UI**: Instant feedback with automatic rollback on errors
- **User Isolation**: See only your own data plus demo content
- **Authentication**: Better Auth integration
- **Offline-First**: Works offline in Electric mode

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL (via Docker or local install)

### Installation

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d

# Generate database schema
pnpm db:push

# Seed demo data
pnpm db:seed

# Start development server
pnpm dev
```

Visit http://localhost:3000

## Project Structure

```
src/
├── components/       # React components
├── db/              # Database schema and connection
├── hooks/           # Custom React hooks
├── lib/             # Utilities and configurations
│   ├── collections/ # TanStack DB collections
│   ├── auth.ts      # Better Auth setup
│   └── mode-context.tsx # Mode switcher
├── routes/          # TanStack Router routes
├── server/          # Server functions
│   └── functions/   # CRUD operations
└── styles/          # Global styles
```

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start)
- **Data Store**: [TanStack DB](https://tanstack.com/db)
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Better Auth
- **Real-time Sync**: ElectricSQL (optional)
- **UI Components**: Custom with Tailwind CSS
- **Editor**: TipTap
- **Drag & Drop**: @dnd-kit

## Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm db:push` - Push schema to database
- `pnpm db:seed` - Seed demo data
- `pnpm lint` - Lint code
- `pnpm format` - Format code

## Learn More

- [TanStack Start Documentation](https://tanstack.com/start)
- [TanStack DB Documentation](https://tanstack.com/db)
- [Original LinearLite](https://github.com/electric-sql/electric/tree/main/examples/linearlite)
- [Porting Plan](../../LINEARLITE_TANSTACK_PORT_PLAN.md)
