# Trellix - TanStack DB Example

A Trello-like kanban board application built with TanStack DB and TanStack Start. This is a port of the [Remix Trellix example](https://github.com/remix-run/example-trellix) to demonstrate TanStack DB's optimistic updates and live queries.

## Features

- Kanban board with columns and cards
- Drag-and-drop card reordering
- Real-time optimistic updates with TanStack DB
- User authentication with better-auth
- PostgreSQL database with Drizzle ORM

## Tech Stack

- **Frontend**: React 19, TanStack Router, TanStack Start
- **State Management**: TanStack DB with Query Collection
- **Backend**: tRPC, Drizzle ORM
- **Database**: PostgreSQL
- **Authentication**: better-auth
- **Styling**: Tailwind CSS

## Getting Started

1. **Start the database**:
   ```bash
   docker compose up -d
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Run migrations**:
   ```bash
   pnpm migrate
   ```

4. **Start the dev server**:
   ```bash
   pnpm dev
   ```

5. Open [http://localhost:5173](http://localhost:5173)

## How It Works

This example demonstrates TanStack DB's key features:

### Collections

The app uses three collections that sync with the server:
- `boardCollection` - User's boards
- `columnCollection` - Columns within a board
- `itemCollection` - Cards within columns

### Live Queries

Components subscribe to data using `useLiveQuery`:

```tsx
const { data: columns } = useLiveQuery((q) =>
  q.from({ columnCollection })
    .where(({ columnCollection }) => eq(columnCollection.boardId, boardId))
    .orderBy(({ columnCollection }) => columnCollection.order)
)
```

### Optimistic Mutations

All mutations are instantly applied locally and synced to the server:

```tsx
columnCollection.insert({
  id: crypto.randomUUID(),
  name: "New Column",
  order: maxOrder + 1,
  boardId,
})
```

### Drag and Drop

Cards can be dragged between columns with optimistic reordering:

```tsx
const handleMoveItem = (itemId: string, newColumnId: string, newOrder: number) => {
  itemCollection.update(itemId, (draft) => {
    draft.columnId = newColumnId
    draft.order = newOrder
  })
}
```

## Project Structure

```
src/
├── db/
│   ├── schema.ts         # Drizzle schema definitions
│   ├── auth-schema.ts    # Auth tables for better-auth
│   └── connection.ts     # Database connection
├── lib/
│   ├── collections.ts    # TanStack DB collections
│   ├── auth.ts           # Server-side auth config
│   ├── auth-client.ts    # Client-side auth
│   ├── trpc.ts           # tRPC router setup
│   ├── trpc-client.ts    # tRPC client
│   └── trpc/
│       ├── boards.ts     # Board CRUD operations
│       ├── columns.ts    # Column CRUD operations
│       └── items.ts      # Item CRUD operations
└── routes/
    ├── __root.tsx        # Root layout
    ├── login.tsx         # Login page
    ├── _authenticated.tsx # Authenticated layout with boards list
    ├── _authenticated/
    │   ├── index.tsx     # Home redirect
    │   └── board/
    │       └── $boardId.tsx  # Board view with columns and cards
    └── api/
        ├── auth.ts       # Auth API handler
        └── trpc/
            └── $.ts      # tRPC API handler
```

## License

MIT
