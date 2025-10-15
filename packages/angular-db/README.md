# @tanstack/angular-db

Angular hooks for TanStack DB. See [TanStack/db](https://github.com/TanStack/db) for more details.

Installation

    npm install @tanstack/angular-db @tanstack/db

Usage

Basic Setup

First, create a collection:

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

Using injectLiveQuery in Components

Direct Collection Usage

The simplest way to use injectLiveQuery is to pass a collection directly:

    import { Component } from "@angular/core"
    import { injectLiveQuery } from "@tanstack/angular-db"
    import { todosCollection } from "./collections/todos-collection"

    @Component({
      selector: "app-all-todos",
      template: `
        @if (allTodos.isReady()) {
          <div>Total todos: {{ allTodos.data().length }}</div>
          @for (todo of allTodos.data(); track todo.id) {
            <div>{{ todo.text }}</div>
          }
        } @else {
          <div>Loading todos...</div>
        }
      `,
    })
    export class AllTodosComponent {
      // Direct collection usage - gets all items
      allTodos = injectLiveQuery(todosCollection)
    }

Static Query Functions

You can create filtered queries using a query function. Note: The query function is evaluated once and is not reactive to signal changes:

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
      // Static query - filters for incomplete todos
      // This will not react to signal changes within the function
      todoQuery = injectLiveQuery((q) =>
        q
          .from({ todo: todosCollection })
          .where(({ todo }) => eq(todo.completed, false))
      )

      toggleTodo(id: number) {
        todosCollection.utils.begin()
        todosCollection.utils.write({
          type: 'update',
          key: id,
          value: { completed: true }
        })
        todosCollection.utils.commit()
      }
    }

Reactive Queries with Parameters

For queries that need to react to component state changes, use the reactive parameters overload:

    import { Component, signal } from "@angular/core"
    import { injectLiveQuery } from "@tanstack/angular-db"
    import { eq } from "@tanstack/db"
    import { todosCollection } from "./collections/todos-collection"

    @Component({
      selector: "app-project-todos",
      template: `
        <select (change)="selectedProjectId.set(+$any($event).target.value)">
          <option [value]="1">Project 1</option>
          <option [value]="2">Project 2</option>
          <option [value]="3">Project 3</option>
        </select>

        @if (todoQuery.isReady()) {
          <div>Todos for project {{ selectedProjectId() }}:</div>
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
      selectedProjectId = signal(1)

      // Reactive query - automatically recreates when selectedProjectId changes
      todoQuery = injectLiveQuery({
        params: () => ({ projectID: this.selectedProjectId() }),
        query: ({ params, q }) =>
          q
            .from({ todo: todosCollection })
            .where(({ todo }) => eq(todo.completed, false))
            .where(({ todo }) => eq(todo.projectID, params.projectID)),
      })
    }

Advanced Configuration

You can also pass a full configuration object:

    import { Component } from "@angular/core"
    import { injectLiveQuery } from "@tanstack/angular-db"
    import { eq } from "@tanstack/db"
    import { todosCollection } from "./collections/todos-collection"

    @Component({
      selector: "app-configured-todos",
      template: `
        @if (todoQuery.isReady()) {
          @for (todo of todoQuery.data(); track todo.id) {
            <div>{{ todo.text }}</div>
          }
        }
      `,
    })
    export class ConfiguredTodosComponent {
      todoQuery = injectLiveQuery({
        query: (q) =>
          q
            .from({ todo: todosCollection })
            .where(({ todo }) => eq(todo.completed, false))
            .select(({ todo }) => ({
              id: todo.id,
              text: todo.text,
            })),
        startSync: true,
        gcTime: 5000,
      })
    }

Important Notes

Reactivity Behavior

- Direct collection: Automatically reactive to collection changes
- Static query function: Query is built once and is not reactive to signals read within the function
- Reactive parameters: Query rebuilds when any signal read in params() changes
- Collection configuration: Static, not reactive to external signals

Lifecycle Management

- injectLiveQuery automatically handles subscription cleanup when the component is destroyed
- Each call to injectLiveQuery creates a new collection instance (no caching/reuse)
- Collections are started immediately and will sync according to their configuration

Template Usage

Use Angular's new control flow syntax for best performance:

    @if (query.isReady()) {
      @for (item of query.data(); track item.id) {
        <div>{{ item.text }}</div>
      }
    } @else if (query.isError()) {
      <div>Error loading data</div>
    } @else {
      <div>Loading...</div>
    }

API

injectLiveQuery()

Angular injection function for TanStack DB live queries. Must be called within an injection context (e.g., component constructor, inject(), or field initializer).

Overloads

    // Direct collection - reactive to collection changes
    function injectLiveQuery<TResult, TKey, TUtils>(
      collection: Collection<TResult, TKey, TUtils>
    ): LiveQueryResult<TResult>

    // Static query function - NOT reactive to signals within function
    function injectLiveQuery<TContext>(
      queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
    ): LiveQueryResult<TContext>

    // Reactive query with parameters - recreates when params() signals change
    function injectLiveQuery<TContext, TParams>(options: {
      params: () => TParams
      query: (args: {
        params: TParams
        q: InitialQueryBuilder
      }) => QueryBuilder<TContext>
    }): LiveQueryResult<TContext>

    // Collection configuration - static configuration
    function injectLiveQuery<TContext>(
      config: LiveQueryCollectionConfig<TContext>
    ): LiveQueryResult<TContext>

Returns

An object with Angular signals:

- data: Signal<Array<T>> - Array of query results, automatically updates
- state: Signal<Map<Key, T>> - Map of results by key, automatically updates
- collection: Signal<Collection> - The underlying collection instance
- status: Signal<CollectionStatus> - Current status ('idle' | 'loading' | 'ready' | 'error' | 'cleaned-up')
- isLoading: Signal<boolean> - true when status is 'loading'
- isReady: Signal<boolean> - true when status is 'ready'
- isIdle: Signal<boolean> - true when status is 'idle'
- isError: Signal<boolean> - true when status is 'error'
- isCleanedUp: Signal<boolean> - true when status is 'cleaned-up'

Parameters

- collection - Existing collection to observe directly
- queryFn - Function that builds a static query using the query builder
- options.params - Reactive function that returns parameters; triggers query rebuild when accessed signals change
- options.query - Function that builds a query using parameters and query builder
- config - Configuration object for creating a live query collection

Requirements

- Angular 16+ (requires signals support)
- Must be called within an Angular injection context
- Automatically handles cleanup when the injector is destroyed
