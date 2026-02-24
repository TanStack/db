---
name: angular-db
description: >
  Angular bindings for TanStack DB. Covers injectLiveQuery with Angular
  signals. Static queries and reactive params with signal-based parameters.
  Return shape (data, state, collection, status, isLoading, isReady,
  isError) as Angular Signals. Angular 16.0.0+ compatibility.
type: framework
library: db
framework: angular
library_version: '0.5.29'
requires:
  - db-core
---

This skill builds on db-core. Read db-core first for collection setup,
query builder syntax, operators, mutations, and sync concepts.

# TanStack DB — Angular

## Setup

```bash
npm install @tanstack/db @tanstack/angular-db
```

Requires Angular 16.0.0+ (signals).

Collections are created outside components in a dedicated module:

```typescript
// collections/todos.ts
import { createCollection, eq } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (todo) => todo.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    },
  }),
)
```

## Hooks and Components

### injectLiveQuery — static query

```typescript
import { Component } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'
import { eq } from '@tanstack/db'
import { todosCollection } from '../collections/todos'

@Component({
  selector: 'app-todo-list',
  template: `
    @if (query.isLoading()) {
      <div>Loading...</div>
    } @else if (query.isError()) {
      <div>Error loading todos</div>
    } @else {
      <ul>
        @for (todo of query.data(); track todo.id) {
          <li (click)="toggle(todo.id)">{{ todo.text }}</li>
        }
      </ul>
    }
  `,
})
export class TodoListComponent {
  query = injectLiveQuery((q) =>
    q.from({ t: todosCollection }).where(({ t }) => eq(t.completed, false)),
  )

  toggle(id: string) {
    todosCollection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }
}
```

All return values (`data`, `state`, `collection`, `status`, `isLoading`,
`isReady`, `isError`) are Angular Signals.

### injectLiveQuery — reactive parameters with signals

Use the object form with `params` for reactive query parameters:

```typescript
import { Component, signal } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'
import { eq, gte } from '@tanstack/db'

@Component({
  selector: 'app-filtered-todos',
  template: `
    <select (change)="status.set($any($event.target).value)">
      <option value="active">Active</option>
      <option value="done">Done</option>
    </select>

    <ul>
      @for (todo of query.data(); track todo.id) {
        <li>{{ todo.text }}</li>
      }
    </ul>
  `,
})
export class FilteredTodosComponent {
  status = signal('active')
  minPriority = signal(0)

  query = injectLiveQuery({
    params: () => ({
      status: this.status(),
      minPriority: this.minPriority(),
    }),
    query: ({ params, q }) =>
      q
        .from({ t: todosCollection })
        .where(({ t }) =>
          and(eq(t.status, params.status), gte(t.priority, params.minPriority)),
        ),
  })
}
```

The `params` function is a computed signal — the query re-runs whenever
any signal read inside `params` changes.

## Angular-Specific Patterns

### Using with Angular services

Collections can be provided through Angular services for dependency
injection:

```typescript
import { Injectable } from '@angular/core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

@Injectable({ providedIn: 'root' })
export class TodoService {
  readonly collection = createCollection(
    queryCollectionOptions({
      queryKey: ['todos'],
      queryFn: () => fetch('/api/todos').then((r) => r.json()),
      getKey: (todo) => todo.id,
    }),
  )

  toggle(id: string) {
    this.collection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }
}
```

## Common Mistakes

No Angular-specific silent failure modes beyond those covered in db-core.
The Angular adapter's signal-based approach handles reactivity tracking
through the `params` function. See db-core/live-queries and
db-core/mutations-optimistic for common mistakes that apply across all
frameworks.
