---
title: TanStack DB Angular Adapter
id: adapter
---

## Installation

```sh
npm install @tanstack/angular-db
```

## Angular inject function

See the [Angular Functions Reference](../reference/index.md) to see the full list of functions available in the Angular Adapter.

For comprehensive documentation on writing queries (filtering, joins, aggregations, etc.), see the [Live Queries Guide](../../guides/live-queries).

## Basic Usage

### injectLiveQuery

The `injectLiveQuery` function creates a live query that automatically updates your component when data changes. It returns Angular signals for reactive state management:

```typescript
import { Component } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'
import { eq } from '@tanstack/db'

@Component({
  selector: 'app-todo-list',
  standalone: true,
  template: `
    @if (isLoading()) {
      <div>Loading...</div>
    } @else {
      <ul>
        @for (todo of data(); track todo.id) {
          <li>{{ todo.text }}</li>
        }
      </ul>
    }
  `
})
export class TodoListComponent {
  { data, isLoading } = injectLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
     .select(({ todos }) => ({ id: todos.id, text: todos.text }))
  )
}
```

### Reactive Parameters

For queries that depend on reactive values, use the `params` option to re-run the query when those values change:

```typescript
import { Component, signal } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'
import { gt } from '@tanstack/db'

@Component({
  selector: 'app-filtered-todos',
  standalone: true,
  template: `
    <div>{{ data().length }} high-priority todos</div>
  `
})
export class FilteredTodosComponent {
  minPriority = signal(5)

  { data } = injectLiveQuery({
    params: () => ({ minPriority: this.minPriority() }),
    query: ({ params, q }) =>
      q.from({ todos: todosCollection })
       .where(({ todos }) => gt(todos.priority, params.minPriority))
  })
}
```

#### When to Use Reactive Parameters

Use the reactive `params` option when your query depends on:
- Component signals
- Input properties
- Computed values
- Other reactive state

When any reactive value accessed in the `params` function changes, the query is recreated and re-executed.

#### What Happens When Parameters Change

When a parameter value changes:
1. The previous live query collection is cleaned up
2. A new query is created with the updated parameter values
3. The component updates automatically through Angular's signals
4. The `isLoading` signal becomes `true` until the new data is ready

#### Best Practices

**Use reactive params for dynamic queries:**

```typescript
import { Component, input, signal } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'
import { eq, and } from '@tanstack/db'

@Component({
  selector: 'app-todo-list',
  standalone: true,
  template: `<div>{{ data().length }} todos</div>`
})
export class TodoListComponent {
  userId = input.required<number>()
  status = signal('active')

  // Good - reactive params track all dependencies
  { data } = injectLiveQuery({
    params: () => ({
      userId: this.userId(),
      status: this.status()
    }),
    query: ({ params, q }) =>
      q.from({ todos: todosCollection })
       .where(({ todos }) => and(
         eq(todos.userId, params.userId),
         eq(todos.status, params.status)
       ))
  })
}
```

**Static queries don't need params:**

```typescript
import { Component } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'

@Component({
  selector: 'app-all-todos',
  standalone: true,
  template: `<div>{{ data().length }} todos</div>`
})
export class AllTodosComponent {
  // No reactive dependencies - query never changes
  { data } = injectLiveQuery((q) =>
    q.from({ todos: todosCollection })
  )
}
```

**Access signals directly in template:**

```typescript
import { Component } from '@angular/core'
import { injectLiveQuery } from '@tanstack/angular-db'
import { eq } from '@tanstack/db'

@Component({
  selector: 'app-todos',
  standalone: true,
  template: `
    <div>Status: {{ status() }}</div>
    <div>Loading: {{ isLoading() }}</div>
    <div>Ready: {{ isReady() }}</div>
    <div>Total: {{ data().length }}</div>
  `
})
export class TodosComponent {
  { data, status, isLoading, isReady } = injectLiveQuery((q) =>
    q.from({ todos: todosCollection })
     .where(({ todos }) => eq(todos.completed, false))
  )
}
```
