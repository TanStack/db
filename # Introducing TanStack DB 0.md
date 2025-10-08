# Introducing TanStack DB 0.1 — Real-time apps without the Rewrite

Really fast web apps are really great to use. Apps like Figma, Linear, and Superhuman have set a new standard for what users expect—instant interactions, seamless collaboration, zero loading states.

Yet despite massive investment in frontend performance—framework optimizations, fine-grained reactivity, React compiler, virtual DOMs—most teams still can't match their speed. Why?

Because we've been optimizing the wrong layer. While the industry focuses on rendering performance, the client-side data processing pipeline remains largely unexplored. Your app slows to a crawl when components loop over thousands of items, when every user interaction triggers cascading re-renders, when reads and writes get blocked waiting for network round-trips.

This is the real performance bottleneck in modern apps—and it gets exponentially worse as your data grows.

This is where TanStack DB enters.

TanStack DB is a new reactive client store for building super fast apps that's **backend agnostic** and **incrementally adoptable**. We help you get from where you are now to where you want to be without pausing development for 6 months for a big rewrite.

TanStack DB works with any data source through pluggable collection creators. Start with your existing REST APIs, then incrementally add real-time sync to specific features that need it—your frontend code stays the same. Whether you're using Electric, Firebase, your own REST API, or want to build something custom, TanStack DB meets you wherever you're at.

TanStack DB extends TanStack Query with typed collections, live queries and optimistic mutations that keep your UI reactive and consistent with minimal re-rendering and sub-millisecond cross-collection queries — even for large, complex apps.

## Usage example

Imagine we already have a backend with a REST API that exposes the `/api/todos` endpoint to fetch a list of todos and mutate them. We can use that REST endpoint with DB.

_Define a Query Collection using TanStack Query:_

```typescript
import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => fetch("/api/todos"),
    getKey: (item) => item.id,
    schema: todoSchema,
    onInsert: async ({ transaction }) => {
        await Promise.all(transaction.mutations.map(mutation =>
          api.todos.create(mutation.modified)
        )
    }
  })
)
```

_Use live queries in your components:_

```typescript
import { useLiveQuery } from "@tanstack/react-db"
import { eq } from "@tanstack/db"

const Todos = () => {
  const { data: todos } = useLiveQuery((query) =>
    query
      .from({ todos: todoCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )

  return <List items={todos} />
}
```

_Make optimistic mutations:_

```typescript
<Button
    onClick={() =>
        todoCollection.insert({
            id: uuid(),
            text: "🔥 Make app faster",
            completed: false,
        })
    }
/>
```

## Why This Matters Now

If you're already using TanStack Query, you've probably faced this architectural choice:

**Option A**: Create view-specific API endpoints that return exactly the data each component needs. Clean, fast, no client-side processing. But now you have dozens of brittle API routes, network waterfalls when components need related data, and tight coupling between frontend views and backend schemas.

**Option B**: Load broader datasets and filter/process them in the client. Fewer API calls, more flexible frontend. But you hit the performance wall we described—`todos.filter()`, `users.find()`, `posts.map()` everywhere, cascade re-rendering when anything changes.

Most teams pick Option A to avoid performance problems, but you're trading client-side complexity for API proliferation and network dependency.

**TanStack DB enables Option C**: Load normalized collections through fewer API calls, then perform fast incremental joins in the client. You get the network efficiency of broad data loading with sub-millisecond query performance that makes Option A unnecessary.

Instead of this:

```javascript
// View-specific API call every time you navigate
const { data: projectTodos } = useQuery(["project-todos", projectId], () =>
  fetchProjectTodosWithUsers(projectId)
)
```

You can do this:

```javascript
// Load normalized collections upfront (3 broader calls)
const todoCollection = createQueryCollection({
  queryKey: ["todos"],
  queryFn: fetchAllTodos,
})
const userCollection = createQueryCollection({
  queryKey: ["users"],
  queryFn: fetchAllUsers,
})
const projectCollection = createQueryCollection({
  queryKey: ["projects"],
  queryFn: fetchAllProjects,
})

// Navigation is instant - no new API calls needed
const { data: activeProjectTodos } = useLiveQuery((query) =>
  query
    .from({ t: todoCollection, u: userCollection, p: projectCollection })
    .join({ type: "inner", on: [`@t.userId`, `=`, `@u.id`] })
    .join({ type: "inner", on: [`@u.projectId`, `=`, `@p.id`] })
    .where("@t.active", "=", true)
    .where("@p.id", "=", currentProject.id)
)
```

Now clicking between projects, users, or views requires zero API calls. All the data is already loaded. New features like "show user workload across all projects" work instantly without touching your backend.

Your API becomes simpler, your network calls reduce dramatically, and your frontend gets faster as your dataset grows.

## The 20MB Question

Here's the deeper architectural shift: **your app would be dramatically faster if you just loaded 20MB of normalized data upfront** instead of making hundreds of small API calls. But most teams can't do this because client-side processing becomes a bottleneck.

Companies like Linear, Figma, and Notion load massive datasets into the client and achieve incredible performance through heavy investment in custom indexing, differential updates, and optimized rendering. But these solutions are too complex and expensive for most teams to build.

TanStack DB brings this capability to everyone through differential dataflow. Instead of choosing between "many fast API calls with network waterfalls" or "few API calls with slow client processing," you get the best of both: fewer network round-trips AND sub-millisecond client-side queries, even with large datasets.

This isn't about sync engines like Electric (though they make this pattern more powerful). It's about enabling a fundamentally different data loading strategy that works with any backend - REST, GraphQL, or real-time sync.

## The Migration Path That Actually Works

Here's what makes TanStack DB different: you don't need to migrate everything at once, and you don't need to change your backend.

**Step 1**: Add TanStack DB alongside your existing TanStack Query setup. Create one collection using `queryCollectionOptions` for your most performance-critical data. Your existing REST API, authentication, and deployment pipeline stay exactly the same.

**Step 2**: Gradually migrate related queries to use the collection. Replace scattered `todos.filter()` calls with fast live queries. Watch rendering performance improve as you eliminate unnecessary re-renders.

**Step 3**: When you need real-time features, upgrade specific collections to use sync engines like Electric or Firebase without changing your frontend code. Your existing REST-based collections keep working—you're just adding real-time capabilities where you need them.

**Step 4**: You've incrementally built a unified, performant reactive store that started with your existing backend and added real-time sync only where it provides value—without stopping feature development or rewriting your entire data layer.

The key insight: TanStack DB lets you keep your existing REST APIs and incrementally add real-time sync to specific features that benefit from it. Your todo list might stay REST-based while your collaborative editor uses Electric sync—same frontend code, different backend strategies where it makes sense.

## Our Goals for TanStack DB

We're building TanStack DB to address the client-side data processing bottleneck that every team eventually hits. Here's what we're aiming for:

**True backend flexibility**: Work with any data source through pluggable collection creators. Whether you're using Electric, Firebase, REST APIs, GraphQL, or building something custom, TanStack DB adapts to your stack. Start with what you have, upgrade when you're ready, mix different approaches in the same app if needed.

**Incremental adoption that actually works**: Start with one collection, add more as you build new features. No big-bang migrations or development pauses.

**Query performance at scale**: Sub-millisecond queries across large datasets through differential dataflow, even when your app has thousands of items.

**Easy Optimistic updates that don't break**: Reliable rollback behavior when network requests fail, without complex custom state management.

**Type safety throughout**: Full TypeScript inference from your schema to your components, catching data mismatches at compile time.

TanStack DB is early software, but we're excited about the potential to give teams a fundamentally better way to handle client-side data processing—while preserving the freedom to choose the backend that works best for their needs.

## What's Next

TanStack DB 0.1 is available now as an early preview. We're specifically looking for teams who:

- Already use TanStack Query and are hitting performance walls with complex state
- Build collaborative features but struggle with slow optimistic updates
- Have 1000+ item datasets that cause rendering performance issues
- Want real-time functionality without rewriting their entire data layer

If your team spends more time optimizing React re-renders than building features, or if your collaborative features feel sluggish compared to Linear/Figma, TanStack DB is designed for exactly your situation.

**Start your migration today:**

- [Documentation & Quick Start](https://tanstack.com/db) - See migration examples from TanStack Query
- [Performance Benchmarks](https://tanstack.com/db/benchmarks) - Compare query speeds on large datasets
- [Join our Discord](https://discord.gg/tanstack) - Get direct migration support from the team

The client-side data processing revolution starts with teams willing to move beyond traditional state management. Be one of them.
