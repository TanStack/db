---
name: angular-db
description: >
  Angular bindings for TanStack DB. injectLiveQuery inject function with
  Angular signals (Signal<T>) for all return values. Reactive params pattern
  ({ params: () => T, query: ({ params, q }) => QueryBuilder }) for dynamic
  queries. Must be called in injection context. Angular 17+ control flow
  (@if, @for) and signal inputs supported. Import from
  @tanstack/angular-db (re-exports all of @tanstack/db).
type: framework
library: db
framework: angular
library_version: '0.6.0'
requires:
  - db-core
sources:
  - 'TanStack/db:docs/framework/angular/overview.md'
  - 'TanStack/db:packages/angular-db/src/index.ts'
---

This skill builds on db-core. Read it first for collection setup, query builder, and mutation patterns.

# TanStack DB — Angular

## Setup

```typescript
import { Component } from '@angular/core'
import { injectLiveQuery, eq, not } from '@tanstack/angular-db'

@Component({
  selector: 'app-todo-list',
  standalone: true,
  template: `
    @if (query.isLoading()) {
      <div>Loading...</div>
    } @else {
      <ul>
        @for (todo of query.data(); track todo.id) {
          <li>{{ todo.text }}</li>
        }
      </ul>
    }
  `,
})
export class TodoListComponent {
  query = injectLiveQuery((q) =>
    q
      .from({ todos: todosCollection })
      .where(({ todos }) => not(todos.completed))
      .orderBy(({ todos }) => todos.created_at, 'asc'),
  )
}
```

`@tanstack/angular-db` re-exports everything from `@tanstack/db`.

## Inject Function

### injectLiveQuery

Returns an object with Angular `Signal<T>` properties — call with `()` in templates:

```typescript
// Static query — no reactive dependencies
const query = injectLiveQuery((q) => q.from({ todo: todoCollection }))
// query.data()       → Array<T>
// query.status()     → CollectionStatus | 'disabled'
// query.isLoading(), query.isReady(), query.isError()
// query.isIdle(), query.isCleanedUp()  (seldom used)
// query.state()      → Map<TKey, T>
// query.collection() → Collection | null

// Reactive params — re-runs when params change
const query = injectLiveQuery({
  params: () => ({ minPriority: this.minPriority() }),
  query: ({ params, q }) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => gt(todo.priority, params.minPriority)),
})

// Config object
const query = injectLiveQuery({
  query: (q) => q.from({ todo: todoCollection }),
  gcTime: 60000,
})

// Pre-created collection
const query = injectLiveQuery(preloadedCollection)

// Conditional query — return undefined/null to disable
const query = injectLiveQuery({
  params: () => ({ userId: this.userId() }),
  query: ({ params, q }) => {
    if (!params.userId) return undefined
    return q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.userId, params.userId))
  },
})
```

## Angular-Specific Patterns

### Reactive params with signals

```typescript
@Component({
  selector: 'app-filtered-todos',
  standalone: true,
  template: `<div>{{ query.data().length }} todos</div>`,
})
export class FilteredTodosComponent {
  minPriority = signal(5)

  query = injectLiveQuery({
    params: () => ({ minPriority: this.minPriority() }),
    query: ({ params, q }) =>
      q
        .from({ todos: todosCollection })
        .where(({ todos }) => gt(todos.priority, params.minPriority)),
  })
}
```

When `params()` return value changes, the previous collection is disposed and a new query is created.

### Signal inputs (Angular 17+)

```typescript
@Component({
  selector: 'app-user-todos',
  standalone: true,
  template: `<div>{{ query.data().length }} todos</div>`,
})
export class UserTodosComponent {
  userId = input.required<number>()

  query = injectLiveQuery({
    params: () => ({ userId: this.userId() }),
    query: ({ params, q }) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.userId, params.userId)),
  })
}
```

### Legacy @Input (Angular 16)

```typescript
export class UserTodosComponent {
  @Input({ required: true }) userId!: number

  query = injectLiveQuery({
    params: () => ({ userId: this.userId }),
    query: ({ params, q }) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.userId, params.userId)),
  })
}
```

### Template syntax

Angular 17+ control flow:

```html
@if (query.isLoading()) {
<div>Loading...</div>
} @else { @for (todo of query.data(); track todo.id) {
<li>{{ todo.text }}</li>
} }
```

Angular 16 structural directives:

```html
<div *ngIf="query.isLoading()">Loading...</div>
<li *ngFor="let todo of query.data(); trackBy: trackById">{{ todo.text }}</li>
```

## Common Mistakes

### CRITICAL Using injectLiveQuery outside injection context

Wrong:

```typescript
export class TodoComponent {
  ngOnInit() {
    this.query = injectLiveQuery((q) => q.from({ todo: todoCollection }))
  }
}
```

Correct:

```typescript
export class TodoComponent {
  query = injectLiveQuery((q) => q.from({ todo: todoCollection }))
}
```

`injectLiveQuery` calls `assertInInjectionContext` internally — it must be called during construction (field initializer or constructor), not in lifecycle hooks.

Source: packages/angular-db/src/index.ts

### HIGH Using query function for reactive values instead of params

Wrong:

```typescript
export class FilteredComponent {
  status = signal('active')

  query = injectLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, this.status())),
  )
}
```

Correct:

```typescript
export class FilteredComponent {
  status = signal('active')

  query = injectLiveQuery({
    params: () => ({ status: this.status() }),
    query: ({ params, q }) =>
      q
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.status, params.status)),
  })
}
```

The plain query function overload does not track Angular signal reads. Use the `params` pattern to make reactive values trigger query re-creation.

Source: packages/angular-db/src/index.ts

### MEDIUM Forgetting to call signals in templates

Wrong:

```html
<div>{{ query.data.length }}</div>
```

Correct:

```html
<div>{{ query.data().length }}</div>
```

All return values are Angular signals. Without `()`, you get the signal object, not the value.

See also: db-core/live-queries/SKILL.md — for query builder API.

See also: db-core/mutations-optimistic/SKILL.md — for mutation patterns.
