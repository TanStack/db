# @tanstack/angular-db

Angular hooks for TanStack DB. See [TanStack/db](https://github.com/TanStack/db) for more details.

## Installation

```bash
npm install @tanstack/angular-db @tanstack/db
```

## Usage

### Basic Setup

First, create a collection:

```typescript
import { createCollection, localOnlyCollectionOptions } from "@tanstack/db"

interface Todo {
  id: number
  text: string
  completed: boolean
  projectID: number
  created_at: Date
}

export const todosCollection = createCollection(
  localOnlyCollectionOptions<Todo>({
    getKey: (todo: Todo) => todo.id,
    initialData: [
      {
        id: 1,
        text: "Learn Angular",
        completed: false,
        projectID: 1,
        created_at: new Date(),
      },
    ],
  })
)
```

### Using injectLiveQuery in Components

```typescript
import { Component } from "@angular/core"
import { injectLiveQuery } from "@tanstack/angular-db"
import { eq } from "@tanstack/db"
import { todosCollection } from "./collections/todos-collection"

@Component({
  selector: "app-todos",
  template: `
    @if (todoQuery.isReady()) {
      @for (todo of todoQuery.data(); track todo.id) {
        <div class="todo-item">
          {{ todo.text }}
          <button (click)="toggleTodo(todo.id)">
            {{ todo.completed ? "Undo" : "Complete" }}
          </button>
        </div>
      }
    } @else {
      <div>Loading todos...</div>
    }
  `,
})
export class TodosComponent {
  // Query todos with a filter
  todoQuery = injectLiveQuery((q) =>
    q
      .from({ todo: todosCollection })
      .where(({ todo }) => eq(todo.completed, false))
  )

  toggleTodo(id: number) {
    todosCollection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }
}
```

### Direct Collection Usage

You can also pass a collection directly to injectLiveQuery:

```typescript
import { Component } from "@angular/core"
import { injectLiveQuery } from "@tanstack/angular-db"
import { todosCollection } from "./collections/todos-collection"

@Component({
  selector: "app-all-todos",
  template: `
    <div>Total todos: {{ allTodos.data().length }}</div>
    @for (todo of allTodos.data(); track todo.id) {
      <div>{{ todo.text }}</div>
    }
  `,
})
export class AllTodosComponent {
  // Direct collection usage - gets all items
  allTodos = injectLiveQuery(todosCollection)
}
```

### Reactive Queries with Parameters

Use reactive parameters to make queries automatically update when component state changes:

```typescript
import { Component, signal } from "@angular/core"
import { injectLiveQuery } from "@tanstack/angular-db"
import { eq } from "@tanstack/db"
import { todosCollection } from "./collections/todos-collection"

@Component({
  selector: "app-project-todos",
  template: `
    <select [(ngModel)]="selectedProjectId">
      <option [value]="1">Project 1</option>
      <option [value]="2">Project 2</option>
      <option [value]="3">Project 3</option>
    </select>

    @if (todoQuery.isReady()) {
      @for (todo of todoQuery.data(); track todo.id) {
        <div class="todo-item">
          {{ todo.text }}
        </div>
      }
    } @else {
      <div>Loading todos...</div>
    }
  `,
})
export class ProjectTodosComponent {
  selectedProjectId = signal(2)

  // Query automatically updates when selectedProjectId changes
  todoQuery = injectLiveQuery({
    params: () => ({ projectID: this.selectedProjectId() }),
    query: ({ params, q }) =>
      q
        .from({ todo: todosCollection })
        .where(({ todo }) => eq(todo.completed, false))
        .where(({ todo }) => eq(todo.projectID, params.projectID)),
  })
}
```

## API

### injectLiveQuery()

Angular injection function for TanStack DB live queries. Must be called within an injection context (e.g., component constructor, inject(), or field initializer).

#### Overloads

```typescript
// Simple query function
function injectLiveQuery<TContext>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): LiveQueryResult<TContext>

// Reactive query with parameters
function injectLiveQuery<TContext, TParams>(options: {
  params: () => TParams
  query: (args: {
    params: TParams
    q: InitialQueryBuilder
  }) => QueryBuilder<TContext>
}): LiveQueryResult<TContext>

// Collection configuration
function injectLiveQuery<TContext>(
  config: LiveQueryCollectionConfig<TContext>
): LiveQueryResult<TContext>

// Direct collection
function injectLiveQuery<TResult, TKey, TUtils>(
  collection: Collection<TResult, TKey, TUtils>
): LiveQueryResult<TResult>
```

#### Returns

An object with Angular signals:

- `data: Signal<Array<T>>` - Array of query results
- `state: Signal<Map<Key, T>>` - Map of results by key
- `collection: Signal<Collection>` - The underlying collection
- `status: Signal<CollectionStatus>` - Current status (loading, ready, error, etc.)
- `isLoading: Signal<boolean>` - True when loading or initializing
- `isReady: Signal<boolean>` - True when data is ready
- `isIdle: Signal<boolean>` - True when idle
- `isError: Signal<boolean>` - True when in error state
- `isCleanedUp: Signal<boolean>` - True when cleaned up

#### Parameters

- `queryFn` - Function that builds a query using the query builder
- `options.params` - Function that returns parameters; query recreates when any accessed signals change
- `options.query` - Function that builds a query using parameters and query builder
- `config` - Configuration object for the live query collection
- `collection` - Existing collection to observe
