# @tanstack/db-devtools

Developer tools for TanStack DB that provide real-time insights into your collections, live queries, and transactions.

## Features

- **Collection Monitoring**: View all active collections with real-time status updates
- **Live Query Insights**: Special handling for live queries with performance metrics
- **Transaction Tracking**: Monitor all database transactions and their states
- **WeakRef Architecture**: Collections are tracked without preventing garbage collection
- **Framework Agnostic**: Core devtools built with Solid.js, with React and Vue wrappers
- **Development Only**: Automatically tree-shaken in production builds

## Installation

```bash
# Core devtools (built with Solid.js)
npm install @tanstack/db-devtools

# React wrapper
npm install @tanstack/react-db-devtools

# Vue wrapper  
npm install @tanstack/vue-db-devtools
```

## Usage

### Core Devtools (Solid.js)

```typescript
import { DbDevtools } from '@tanstack/db-devtools'

// Initialize devtools (must be called before creating collections)
import { initializeDbDevtools } from '@tanstack/db-devtools'
initializeDbDevtools()

// Use the devtools component
function App() {
  return (
    <div>
      <h1>My App</h1>
      <DbDevtools />
    </div>
  )
}
```

### React

```tsx
import { ReactDbDevtools } from '@tanstack/react-db-devtools'

function App() {
  return (
    <div>
      <h1>My App</h1>
      <ReactDbDevtools />
    </div>
  )
}
```

### Vue

```vue
<template>
  <div>
    <h1>My App</h1>
    <VueDbDevtools />
  </div>
</template>

<script setup>
import { VueDbDevtools } from '@tanstack/vue-db-devtools'
</script>
```

## Configuration

The devtools accept the following configuration options:

```typescript
interface DbDevtoolsConfig {
  initialIsOpen?: boolean
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'relative'
  panelProps?: Record<string, any>
  closeButtonProps?: Record<string, any>
  toggleButtonProps?: Record<string, any>
  storageKey?: string
  panelState?: 'open' | 'closed'
  onPanelStateChange?: (isOpen: boolean) => void
}
```

## Architecture

### Auto-Registration

Collections automatically register themselves with the devtools when created:

```typescript
// When devtools are initialized, this creates a window global
window.__TANSTACK_DB_DEVTOOLS__

// Collections check for this global and register themselves
const collection = createCollection({
  // ... config
})
// Collection is now visible in devtools
```

### WeakRef Design

The devtools use WeakRef to track collections without preventing garbage collection:

- **Metadata polling**: Basic info (size, status) is polled every second
- **Hard references**: Only created when viewing collection details
- **Automatic cleanup**: Dead references are garbage collected

### Live Query Detection

Live queries are automatically detected and shown separately:

```typescript
// This will be marked as a live query in devtools
const liveQuery = createLiveQueryCollection({
  query: (q) => q.from(collection).select()
})
```

## What You Can See

### Collections View
- Collection ID and type (regular vs live query)
- Status (idle, loading, ready, error, cleaned-up)
- Current size and transaction count
- Creation and last update timestamps
- Garbage collection settings

### Live Queries View
- All the above plus:
- Initial run time
- Total incremental runs
- Average incremental run time
- Last incremental run time

### Transactions View
- Transaction ID and state
- Associated collection
- Mutation details (insert, update, delete)
- Optimistic vs confirmed operations
- Creation and update timestamps

### Collection Details
- Full collection metadata
- Live data with real-time updates
- Individual item inspection
- JSON view of all items

## Performance

The devtools are designed to have minimal impact on your application:

- **Development only**: Automatically removed in production
- **WeakRef tracking**: No memory leaks from collection references
- **Efficient polling**: Only basic metadata is polled, detailed data is fetched on-demand
- **Lazy loading**: UI components are loaded only when needed

## Browser Support

Requires modern browsers that support WeakRef (Chrome 84+, Firefox 79+, Safari 14.1+).
Since this is development-only, this should not be a concern for production applications.