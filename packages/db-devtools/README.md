# @tanstack/db-devtools

Developer tools for TanStack DB that provide real-time insights into your collections, live queries, and transactions.

## Installation

```bash
npm install @tanstack/db-devtools
npm install @tanstack/react-db-devtools
```

## Usage

### With TanStack Devtools (Recommended)

```tsx
import { TanstackDevtools } from "@tanstack/react-devtools"
import { TanStackReactDbDevtoolsPanel } from "@tanstack/react-db-devtools"

function App() {
  return (
    <TanstackDevtools
      plugins={[
        {
          name: "Tanstack DB",
          render: <TanStackReactDbDevtoolsPanel />,
        },
      ]}
    />
  )
}
```

### Standalone Component

```tsx
import { ReactDbDevtools } from "@tanstack/react-db-devtools"

function App() {
  return (
    <div>
      <h1>My App</h1>
      <ReactDbDevtools position="bottom-right" />
    </div>
  )
}
```

## Features

- **Collection Monitoring**: View all active collections with real-time status updates
- **Live Query Insights**: Special handling for live queries with performance metrics
- **Transaction Tracking**: Monitor all database transactions and their states
- **Development Only**: Automatically tree-shaken in production builds

## What You Can See

- Collection status, size, and transaction count
- Live query performance metrics
- Transaction details and states
- Real-time data inspection
- Collection metadata and settings

Collections automatically register themselves with the devtools when created - no additional setup required.
