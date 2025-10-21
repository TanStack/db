# TanStack Start Comprehensive Guide

A complete guide to building full-stack applications with TanStack Start, including integration with TanStack DB.

## Table of Contents

1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Getting Started](#getting-started)
4. [File-Based Routing](#file-based-routing)
5. [Pages and Layouts](#pages-and-layouts)
6. [Data Loading and Server Functions](#data-loading-and-server-functions)
7. [Client-Side Navigation](#client-side-navigation)
8. [State Management Integration](#state-management-integration)
9. [SSR and Hydration](#ssr-and-hydration)
10. [API Routes](#api-routes)
11. [Middleware and Context](#middleware-and-context)
12. [Error Handling](#error-handling)
13. [Forms and Validation](#forms-and-validation)
14. [Integration with TanStack DB](#integration-with-tanstack-db)
15. [Deployment](#deployment)
16. [Best Practices](#best-practices)
17. [Complete Examples](#complete-examples)

---

## Introduction

**TanStack Start** is a full-stack React framework powered by TanStack Router that provides:

- **Full-document SSR** - Server-side rendering for better performance and SEO
- **Streaming** - Progressive page loading for improved user experience
- **Server Functions** - Type-safe RPCs between client and server
- **Server Routes & API Routes** - Build backend endpoints alongside your frontend
- **Middleware & Context** - Powerful request/response handling
- **Full-Stack Bundling** - Optimized builds via Vite
- **End-to-End Type Safety** - Full TypeScript support
- **Built on Nitro** - Deploy anywhere (Vercel, Cloudflare, AWS, etc.)

TanStack Start relies 100% on TanStack Router for its routing system and integrates seamlessly with the entire TanStack ecosystem (Query, Form, Table, DB).

---

## Project Structure

A typical TanStack Start project structure:

```
my-tanstack-app/
├── src/
│   ├── routes/              # File-based routing (pages & API routes)
│   │   ├── __root.tsx       # Root layout
│   │   ├── index.tsx        # Home page (/)
│   │   ├── about.tsx        # About page (/about)
│   │   ├── _layout.tsx      # Pathless layout
│   │   └── api/             # API routes
│   │       └── users.ts     # API endpoint (/api/users)
│   ├── components/          # Reusable components
│   ├── hooks/               # Custom hooks
│   ├── utils/               # Utility functions
│   ├── router.tsx           # Router configuration
│   ├── client.tsx           # Client entry point
│   └── ssr.tsx              # Server entry point
├── public/                  # Static assets
├── vite.config.ts           # Vite configuration
├── package.json
└── tsconfig.json
```

### Key Files

**`src/routes/__root.tsx`** - Root layout wrapping all routes:
```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { Meta, Scripts } from '@tanstack/react-start'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <Meta />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
```

**`src/router.tsx`** - Router configuration:
```typescript
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadDelay: 50,
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
```

**`vite.config.ts`** - Vite configuration:
```typescript
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    // React's vite plugin must come after start's vite plugin
    viteReact(),
  ],
})
```

---

## Getting Started

### Installation

#### Option 1: Use Starter Template
```bash
# Clone the official basic example
npx gitpick TanStack/router/tree/main/examples/react/start-basic start-basic
cd start-basic
npm install
npm run dev
```

#### Option 2: Create from Scratch
```bash
# Create a new project
npm create vite@latest my-app -- --template react-ts
cd my-app

# Install TanStack Start
npm install @tanstack/react-router @tanstack/react-start @tanstack/react-start/plugin/vite

# Install dev dependencies
npm install -D @tanstack/router-devtools @tanstack/router-plugin

# Start development server
npm run dev
```

### Available Starter Templates

1. **dotnize/react-tanstarter** - TanStack Start + Better Auth + Drizzle ORM + shadcn/ui
2. **ally-ahmed/tss-app** - TanStack Start + shadcn/ui + tRPC + Drizzle + Lucia-Auth
3. **mwolf1989/tanstack-starter** - TanStack Start + Supabase Auth
4. **Kiranism/tanstack-start-dashboard** - Dashboard with TanStack Table + server-side operations

---

## File-Based Routing

TanStack Start uses file-based routing where files and directories in `src/routes/` represent your application's routes.

### Routing Conventions

#### 1. Index Routes
```
src/routes/index.tsx        → /
src/routes/about/index.tsx  → /about
```

#### 2. Named Routes
```
src/routes/about.tsx        → /about
src/routes/blog.tsx         → /blog
```

#### 3. Dynamic Routes (Parameters)
```
src/routes/posts/$id.tsx           → /posts/:id
src/routes/users/$userId.tsx       → /users/:userId
src/routes/blog/$slug.tsx          → /blog/:slug
```

#### 4. Nested Routes (Directory-based)
```
src/routes/
  ├── app/
  │   ├── index.tsx           → /app
  │   ├── dashboard.tsx       → /app/dashboard
  │   └── settings.tsx        → /app/settings
```

#### 5. Nested Routes (Flat routing with dots)
```
src/routes/
  ├── app.tsx                 → /app (layout)
  ├── app.dashboard.tsx       → /app/dashboard
  └── app.settings.tsx        → /app/settings
```

#### 6. Pathless Layout Routes (underscore prefix)
```
src/routes/
  ├── _layout.tsx             → Layout without affecting URL
  ├── _layout.home.tsx        → / (with layout)
  └── _layout.about.tsx       → /about (with layout)
```

#### 7. Co-locating Non-Route Files (dash prefix)
```
src/routes/
  ├── posts.tsx
  └── -components/            → Ignored by router
      └── PostCard.tsx
```

### Route File Example

```tsx
// src/routes/posts/$id.tsx
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

// Server function to fetch post
const getPost = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    // Fetch from database
    const post = await db.posts.findById(id)
    if (!post) throw new Error('Post not found')
    return post
  })

// Route definition
export const Route = createFileRoute('/posts/$id')({
  component: PostPage,
  loader: async ({ params }) => await getPost({ data: params.id }),
})

// Component
function PostPage() {
  const post = Route.useLoaderData()
  const { id } = Route.useParams()

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  )
}
```

---

## Pages and Layouts

### Creating a Basic Page

```tsx
// src/routes/about.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
      <p>Welcome to our application!</p>
    </div>
  )
}
```

### Layout Routes with Outlet

The `Outlet` component renders child routes:

```tsx
// src/routes/_layout.tsx
import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout')({
  component: LayoutComponent,
})

function LayoutComponent() {
  return (
    <div className="layout">
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main>
        <Outlet />  {/* Child routes render here */}
      </main>
      <footer>© 2025 My App</footer>
    </div>
  )
}
```

### Nested Layouts

```tsx
// src/routes/app.tsx (Parent layout)
import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app')({
  component: AppLayout,
})

function AppLayout() {
  return (
    <div className="app-container">
      <aside>
        <nav>
          <a href="/app/dashboard">Dashboard</a>
          <a href="/app/settings">Settings</a>
        </nav>
      </aside>
      <div className="app-content">
        <Outlet />
      </div>
    </div>
  )
}
```

```tsx
// src/routes/app/dashboard.tsx (Child route)
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  return <h1>Dashboard</h1>
}
```

### Root Layout with Providers

```tsx
// src/routes/__root.tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Meta, Scripts } from '@tanstack/react-start'

const queryClient = new QueryClient()

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <Meta />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
```

---

## Data Loading and Server Functions

TanStack Start provides server functions for type-safe data fetching and mutations.

### Server Functions Basics

Server functions execute **only on the server** but can be called from client or server code.

```tsx
import { createServerFn } from '@tanstack/react-start'

// GET request (default)
const getData = createServerFn({ method: 'GET' })
  .handler(async () => {
    return { message: 'Hello from server!' }
  })

// POST request with validation
const updateData = createServerFn({ method: 'POST' })
  .inputValidator((input: { name: string }) => input)
  .handler(async ({ data }) => {
    // data is type-safe
    await db.users.update(data)
    return { success: true }
  })
```

### Route Loaders

Loaders fetch data before rendering:

```tsx
// src/routes/posts/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

const getPosts = createServerFn({ method: 'GET' }).handler(async () => {
  const posts = await db.posts.findAll()
  return posts
})

export const Route = createFileRoute('/posts/')({
  component: PostsPage,
  loader: async () => await getPosts(),
})

function PostsPage() {
  const posts = Route.useLoaderData()

  return (
    <div>
      <h1>Posts</h1>
      <ul>
        {posts.map(post => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
    </div>
  )
}
```

### Complete Example: Counter with Server State

```tsx
import * as fs from 'node:fs'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

const filePath = 'count.txt'

async function readCount() {
  return parseInt(
    await fs.promises.readFile(filePath, 'utf-8').catch(() => '0'),
  )
}

const getCount = createServerFn({ method: 'GET' }).handler(() => {
  return readCount()
})

const updateCount = createServerFn({ method: 'POST' })
  .inputValidator((d: number) => d)
  .handler(async ({ data }) => {
    const count = await readCount()
    await fs.promises.writeFile(filePath, `${count + data}`)
  })

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => await getCount(),
})

function Home() {
  const router = useRouter()
  const state = Route.useLoaderData()

  return (
    <button
      type="button"
      onClick={() => {
        updateCount({ data: 1 }).then(() => {
          router.invalidate() // Refetch data
        })
      }}
    >
      Add 1 to {state}?
    </button>
  )
}
```

### External API Example

```tsx
import { createServerFn } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'

const getProjects = createServerFn({ method: 'GET' }).handler(async () => {
  const res = await fetch(
    'https://api.github.com/users/tanstack/repos?sort=updated&per_page=5',
    {
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
        accept: 'application/vnd.github+json',
      },
    }
  )
  return res.json()
})

export const Route = createFileRoute('/projects')({
  component: Projects,
  loader: () => getProjects(),
})

function Projects() {
  const projects = Route.useLoaderData()

  return (
    <div>
      <h1>GitHub Projects</h1>
      {projects.map((project: any) => (
        <div key={project.id}>
          <h2>{project.name}</h2>
          <p>{project.description}</p>
        </div>
      ))}
    </div>
  )
}
```

### beforeLoad Hook

Execute logic before loading data (e.g., authentication checks):

```tsx
export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ context, location }) => {
    const user = await getUser()
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { user }
  },
  loader: async ({ context }) => {
    // context.user is available
    return getUserData(context.user.id)
  },
  component: DashboardPage,
})
```

---

## Client-Side Navigation

### Link Component

The `Link` component provides type-safe navigation with automatic prefetching:

```tsx
import { Link } from '@tanstack/react-router'

function Navigation() {
  return (
    <nav>
      {/* Basic link */}
      <Link to="/">Home</Link>

      {/* Link with params */}
      <Link to="/posts/$id" params={{ id: '123' }}>
        View Post
      </Link>

      {/* Link with search params */}
      <Link to="/search" search={{ query: 'tanstack', page: 1 }}>
        Search
      </Link>

      {/* Prefetch on hover (default: intent) */}
      <Link to="/about" preload="intent">
        About
      </Link>

      {/* Active link styling */}
      <Link
        to="/blog"
        activeProps={{ className: 'active' }}
        inactiveProps={{ className: 'inactive' }}
      >
        Blog
      </Link>
    </nav>
  )
}
```

### Programmatic Navigation

```tsx
import { useNavigate, useRouter } from '@tanstack/react-router'

function MyComponent() {
  const navigate = useNavigate()
  const router = useRouter()

  const handleClick = () => {
    // Navigate to a route
    navigate({ to: '/about' })

    // Navigate with params
    navigate({ to: '/posts/$id', params: { id: '123' } })

    // Navigate with search
    navigate({ to: '/search', search: { query: 'test' } })

    // Go back
    router.history.back()

    // Invalidate and refetch data
    router.invalidate()
  }

  return <button onClick={handleClick}>Navigate</button>
}
```

### Router Invalidation

Force refetch of route data:

```tsx
import { useRouter } from '@tanstack/react-router'

function RefreshButton() {
  const router = useRouter()

  return (
    <button onClick={() => router.invalidate()}>
      Refresh Data
    </button>
  )
}
```

### Prefetching

```tsx
import { Link } from '@tanstack/react-router'

// Prefetch on intent (hover/touchstart) - default with 50ms delay
<Link to="/posts" preload="intent">Posts</Link>

// Prefetch immediately
<Link to="/posts" preload={true}>Posts</Link>

// Disable prefetching
<Link to="/posts" preload={false}>Posts</Link>
```

Configure default prefetching in router:

```typescript
// src/router.tsx
export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadDelay: 50, // milliseconds
  })
  return router
}
```

---

## State Management Integration

TanStack Start integrates seamlessly with the TanStack ecosystem and other state management solutions.

### TanStack Query Integration

```tsx
// src/routes/__root.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, createRootRoute } from '@tanstack/react-router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
})

export const Route = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  ),
})
```

```tsx
// Using in a component
import { useQuery, useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

const fetchPosts = createServerFn({ method: 'GET' }).handler(async () => {
  return await db.posts.findAll()
})

const createPost = createServerFn({ method: 'POST' })
  .inputValidator((data: { title: string; content: string }) => data)
  .handler(async ({ data }) => {
    return await db.posts.create(data)
  })

export const Route = createFileRoute('/posts/')({
  component: PostsPage,
})

function PostsPage() {
  const { data: posts, isLoading } = useQuery({
    queryKey: ['posts'],
    queryFn: () => fetchPosts(),
  })

  const mutation = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      <h1>Posts</h1>
      {posts?.map(post => (
        <div key={post.id}>{post.title}</div>
      ))}
    </div>
  )
}
```

### URL State Management

TanStack Router provides built-in URL state management:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

// Define search params schema
const searchSchema = z.object({
  page: z.number().default(1),
  query: z.string().default(''),
  sort: z.enum(['asc', 'desc']).default('asc'),
})

export const Route = createFileRoute('/search')({
  validateSearch: searchSchema,
  component: SearchPage,
})

function SearchPage() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()

  const updateSearch = (updates: Partial<typeof search>) => {
    navigate({ search: { ...search, ...updates } })
  }

  return (
    <div>
      <input
        value={search.query}
        onChange={(e) => updateSearch({ query: e.target.value })}
      />
      <div>Page: {search.page}</div>
      <button onClick={() => updateSearch({ page: search.page + 1 })}>
        Next Page
      </button>
    </div>
  )
}
```

### Context-Based State

```tsx
// src/routes/__root.tsx
import { createContext, useState, useContext } from 'react'
import { Outlet, createRootRoute } from '@tanstack/react-router'

type ThemeContext = {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContext | null>(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className={theme}>
        <Outlet />
      </div>
    </ThemeContext.Provider>
  )
}
```

---

## SSR and Hydration

TanStack Start provides full-document SSR with streaming support and hydration.

### How SSR Works in TanStack Start

1. **Server**: Routes are matched → `beforeLoad` executes → `loader` executes → Components render to HTML
2. **Client**: HTML is sent → Client hydrates → Application becomes interactive
3. **Navigation**: Subsequent navigations run on client-side

### Selective SSR Options

Control SSR behavior per route:

```tsx
export const Route = createFileRoute('/my-route')({
  // Option 1: Full SSR (default)
  ssr: true,  // Runs loaders & renders on server, then client

  // Option 2: Data-only SSR
  ssr: 'data-only',  // Runs loaders on server, but component renders only on client

  // Option 3: Client-only
  ssr: false,  // Everything runs only on client

  component: MyComponent,
  loader: async () => {
    return await fetchData()
  },
})
```

**When to use each mode:**

- `ssr: true` - Default, best for SEO and initial page load
- `ssr: 'data-only'` - For components with browser-only APIs but server data
- `ssr: false` - For purely client-side features (charts, maps, etc.)

### Streaming SSR

TanStack Start supports streaming for better perceived performance:

```tsx
import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>

      {/* This content streams to client as it loads */}
      <Suspense fallback={<div>Loading metrics...</div>}>
        <Metrics />
      </Suspense>

      <Suspense fallback={<div>Loading chart...</div>}>
        <Chart />
      </Suspense>
    </div>
  )
}
```

### Handling Hydration Errors

Common hydration errors occur when server and client render differently:

```tsx
// ❌ Bad: Causes hydration mismatch
function Component() {
  return <div>{Date.now()}</div>
}

// ✅ Good: Consistent on server and client
function Component() {
  const [time, setTime] = useState<number | null>(null)

  useEffect(() => {
    setTime(Date.now())
  }, [])

  return <div>{time ?? 'Loading...'}</div>
}
```

### Server vs Client Detection

```tsx
import { useEffect, useState } from 'react'

function useIsClient() {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  return isClient
}

function MyComponent() {
  const isClient = useIsClient()

  if (!isClient) {
    return <div>Server render</div>
  }

  return <div>Client render with browser APIs</div>
}
```

---

## API Routes

TanStack Start allows you to create server-side API endpoints alongside your pages.

### Creating API Routes

API routes are defined in `src/routes/api/` or with `.api.ts` suffix:

```tsx
// src/routes/api/users.ts
import { json } from '@tanstack/react-start'

export async function GET() {
  const users = await db.users.findAll()
  return json(users)
}

export async function POST({ request }: { request: Request }) {
  const data = await request.json()
  const user = await db.users.create(data)
  return json(user, { status: 201 })
}
```

### Dynamic API Routes

```tsx
// src/routes/api/users/$id.ts
import { json } from '@tanstack/react-start'

export async function GET({ params }: { params: { id: string } }) {
  const user = await db.users.findById(params.id)

  if (!user) {
    return json({ error: 'User not found' }, { status: 404 })
  }

  return json(user)
}

export async function PUT({ params, request }: { params: { id: string }, request: Request }) {
  const data = await request.json()
  const user = await db.users.update(params.id, data)
  return json(user)
}

export async function DELETE({ params }: { params: { id: string } }) {
  await db.users.delete(params.id)
  return json({ success: true })
}
```

### API Route Examples

**File Naming Convention:**
```
/routes/api/users.ts          → /api/users
/routes/api/users/index.ts    → /api/users
/routes/api/users/$id.ts      → /api/users/:id
/routes/api/users/$id/posts.ts → /api/users/:id/posts
```

**Complete CRUD API:**

```tsx
// src/routes/api/posts/index.ts
import { json } from '@tanstack/react-start'

// GET /api/posts
export async function GET({ request }: { request: Request }) {
  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '10')

  const posts = await db.posts.findMany({
    skip: (page - 1) * limit,
    take: limit,
  })

  return json({ posts, page, limit })
}

// POST /api/posts
export async function POST({ request }: { request: Request }) {
  const data = await request.json()

  // Validate
  if (!data.title || !data.content) {
    return json({ error: 'Missing required fields' }, { status: 400 })
  }

  const post = await db.posts.create(data)
  return json(post, { status: 201 })
}
```

```tsx
// src/routes/api/posts/$id.ts
import { json } from '@tanstack/react-start'

// GET /api/posts/:id
export async function GET({ params }: { params: { id: string } }) {
  const post = await db.posts.findById(params.id)

  if (!post) {
    return json({ error: 'Post not found' }, { status: 404 })
  }

  return json(post)
}

// PUT /api/posts/:id
export async function PUT({ params, request }: { params: { id: string }, request: Request }) {
  const data = await request.json()
  const post = await db.posts.update(params.id, data)
  return json(post)
}

// DELETE /api/posts/:id
export async function DELETE({ params }: { params: { id: string } }) {
  await db.posts.delete(params.id)
  return json({ message: 'Post deleted' })
}
```

### Calling API Routes from Client

```tsx
// Using fetch
async function createPost(data: { title: string; content: string }) {
  const response = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return response.json()
}

// Using TanStack Query
import { useMutation } from '@tanstack/react-query'

function useCreatePost() {
  return useMutation({
    mutationFn: async (data: { title: string; content: string }) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return response.json()
    },
  })
}
```

---

## Middleware and Context

Middleware allows you to customize request/response handling and inject context.

### Server Function Middleware

```tsx
import { createMiddleware } from '@tanstack/react-start'

// Authentication middleware
const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await getSessionFromRequest(request)

  if (!session) {
    throw new Error('Unauthorized')
  }

  // Pass user to context
  return next({
    context: {
      user: session.user,
    },
  })
})

// Use in server function
const getProtectedData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    // context.user is available and type-safe
    const data = await db.getData(context.user.id)
    return data
  })
```

### Request/Response Utilities

```tsx
import { getHeaders, setHeader, getWebRequest } from '@tanstack/react-start'

const myServerFn = createServerFn({ method: 'POST' })
  .handler(async () => {
    // Get request headers
    const headers = getHeaders()
    const authHeader = headers.get('authorization')

    // Set response header
    setHeader('X-Custom-Header', 'value')

    // Get full web request
    const request = getWebRequest()
    const url = new URL(request.url)

    return { success: true }
  })
```

### Route Context

Pass data through route hierarchy:

```tsx
// Parent route provides context
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: '/login' })

    return {
      user,  // Available to child routes
    }
  },
})

// Child route uses context
export const Route = createFileRoute('/_authenticated/dashboard')({
  loader: async ({ context }) => {
    // context.user is available
    return getUserDashboard(context.user.id)
  },
  component: DashboardPage,
})

function DashboardPage() {
  const { user } = Route.useRouteContext()
  return <h1>Welcome, {user.name}!</h1>
}
```

### Global Middleware Example

```tsx
// src/middleware/logger.ts
import { createMiddleware } from '@tanstack/react-start'

export const loggerMiddleware = createMiddleware().server(async ({ next, request }) => {
  const start = Date.now()
  const url = new URL(request.url)

  console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}`)

  const response = await next()

  const duration = Date.now() - start
  console.log(`[${new Date().toISOString()}] Completed in ${duration}ms`)

  return response
})
```

---

## Error Handling

TanStack Start provides built-in error handling with error boundaries and custom error components.

### Route-Level Error Components

```tsx
import { createFileRoute, ErrorComponent } from '@tanstack/react-router'

export const Route = createFileRoute('/posts')({
  component: PostsPage,
  loader: async () => {
    const posts = await fetchPosts()
    if (!posts) throw new Error('Failed to load posts')
    return posts
  },
  errorComponent: ({ error }) => {
    return (
      <div className="error">
        <h1>Error Loading Posts</h1>
        <p>{error.message}</p>
        <button onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  },
})

function PostsPage() {
  const posts = Route.useLoaderData()
  return <div>{/* render posts */}</div>
}
```

### Global Error Component

```tsx
// src/routes/__root.tsx
import { createRootRoute, ErrorComponent } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: GlobalErrorComponent,
})

function GlobalErrorComponent({ error, reset }: { error: Error, reset: () => void }) {
  return (
    <div className="global-error">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

### Not Found Errors

```tsx
import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$id')({
  loader: async ({ params }) => {
    const post = await getPost(params.id)
    if (!post) {
      throw notFound()
    }
    return post
  },
  component: PostPage,
  notFoundComponent: () => {
    return (
      <div>
        <h1>404 - Post Not Found</h1>
        <Link to="/posts">Back to Posts</Link>
      </div>
    )
  },
})
```

### Error Boundaries with TanStack Query

```tsx
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { ErrorBoundary } from 'react-error-boundary'

function MyPage() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }) => (
            <div>
              <h1>Error occurred</h1>
              <p>{error.message}</p>
              <button onClick={resetErrorBoundary}>Try again</button>
            </div>
          )}
        >
          <MyComponent />
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
```

### Server Function Error Handling

```tsx
import { createServerFn } from '@tanstack/react-start'

const myServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { email: string }) => data)
  .handler(async ({ data }) => {
    try {
      const result = await sendEmail(data.email)
      return { success: true }
    } catch (error) {
      // Log server-side
      console.error('Email send failed:', error)

      // Return error to client
      throw new Error('Failed to send email. Please try again.')
    }
  })

// In component
function MyForm() {
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (email: string) => {
    try {
      await myServerFn({ data: { email } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {/* form */}
    </div>
  )
}
```

---

## Forms and Validation

TanStack Start integrates with TanStack Form for type-safe form handling with server validation.

### Basic Form with TanStack Form

```tsx
import { useForm } from '@tanstack/react-form'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
})

const createUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await db.users.create(data)
    return user
  })

function UserForm() {
  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
    },
    onSubmit: async ({ value }) => {
      try {
        await createUser({ data: value })
        alert('User created!')
      } catch (error) {
        alert('Error creating user')
      }
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => (
          <div>
            <label>Name</label>
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors && (
              <span>{field.state.meta.errors.join(', ')}</span>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="email">
        {(field) => (
          <div>
            <label>Email</label>
            <input
              type="email"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors && (
              <span>{field.state.meta.errors.join(', ')}</span>
            )}
          </div>
        )}
      </form.Field>

      <button type="submit" disabled={!form.state.canSubmit}>
        Submit
      </button>
    </form>
  )
}
```

### Field-Level Validation

```tsx
import { useForm } from '@tanstack/react-form'

function MyForm() {
  const form = useForm({
    defaultValues: {
      username: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      await submitForm(value)
    },
  })

  return (
    <form>
      <form.Field
        name="username"
        validators={{
          onChange: ({ value }) => {
            if (value.length < 3) {
              return 'Username must be at least 3 characters'
            }
          },
          onBlur: async ({ value }) => {
            // Async validation
            const exists = await checkUsernameExists(value)
            if (exists) {
              return 'Username already taken'
            }
          },
        }}
      >
        {(field) => (
          <div>
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors && (
              <span>{field.state.meta.errors[0]}</span>
            )}
          </div>
        )}
      </form.Field>
    </form>
  )
}
```

### Server-Side Validation

```tsx
import { createServerValidate, ServerValidateError } from '@tanstack/react-form/start'
import { z } from 'zod'

const userSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
})

const serverValidateUser = createServerValidate({
  validator: userSchema,
})

const createUser = createServerFn({ method: 'POST' })
  .handler(async ({ data }) => {
    // Server-side validation
    const validation = await serverValidateUser(data)

    if (!validation.success) {
      throw new ServerValidateError(validation.errors)
    }

    // Proceed with validated data
    return await db.users.create(validation.data)
  })
```

### Integration with Mutations

```tsx
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

function PostForm() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })

  const form = useForm({
    defaultValues: {
      title: '',
      content: '',
    },
    onSubmit: async ({ value }) => {
      mutation.mutate(value)
    },
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
      {/* form fields */}
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Creating...' : 'Create Post'}
      </button>
      {mutation.isError && (
        <div className="error">Error: {mutation.error.message}</div>
      )}
    </form>
  )
}
```

---

## Integration with TanStack DB

TanStack DB provides a local-first database solution that integrates seamlessly with TanStack Start and TanStack Query.

### Installation

```bash
npm install @tanstack/db @tanstack/query-db-collection
```

### Setting Up TanStack DB Collections

```tsx
// src/db/collections.ts
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

// Define schema
interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: number
}

// Create collection
export const todosCollection = createCollection<Todo>({
  name: 'todos',
  key: 'id',

  // Local-first storage
  storage: {
    type: 'localStorage',
    key: 'todos-db',
  },
})

// Create query collection options for TanStack Query integration
export const todosQueryOptions = queryCollectionOptions({
  collection: todosCollection,

  // Define sync with server
  queryFn: async () => {
    const response = await fetch('/api/todos')
    return response.json()
  },

  // Define mutation handlers
  onMutate: async ({ type, data }) => {
    if (type === 'create') {
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    if (type === 'update') {
      await fetch(`/api/todos/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    if (type === 'delete') {
      await fetch(`/api/todos/${data.id}`, {
        method: 'DELETE',
      })
    }
  },
})
```

### Using Collections in Components

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useCollection } from '@tanstack/db'
import { useCollectionQuery } from '@tanstack/query-db-collection'
import { todosCollection, todosQueryOptions } from '../db/collections'

export const Route = createFileRoute('/todos')({
  component: TodosPage,
})

function TodosPage() {
  // Use collection with TanStack Query for sync
  const { data: todos } = useCollectionQuery(todosQueryOptions)

  // Access collection methods
  const collection = useCollection(todosCollection)

  const addTodo = async (title: string) => {
    await collection.add({
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: Date.now(),
    })
  }

  const toggleTodo = async (id: string) => {
    const todo = await collection.get(id)
    if (todo) {
      await collection.update(id, { completed: !todo.completed })
    }
  }

  const deleteTodo = async (id: string) => {
    await collection.delete(id)
  }

  return (
    <div>
      <h1>Todos</h1>

      <form onSubmit={(e) => {
        e.preventDefault()
        const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement
        addTodo(input.value)
        input.value = ''
      }}>
        <input name="title" placeholder="Add todo..." />
        <button type="submit">Add</button>
      </form>

      <ul>
        {todos?.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
            />
            <span style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}>
              {todo.title}
            </span>
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### Server Functions with TanStack DB

```tsx
// src/routes/api/todos.ts
import { createServerFn } from '@tanstack/react-start'
import { json } from '@tanstack/react-start'

// Server-side database (e.g., Prisma, Drizzle)
import { db } from '../db/server'

export async function GET() {
  const todos = await db.todo.findMany()
  return json(todos)
}

export async function POST({ request }: { request: Request }) {
  const data = await request.json()
  const todo = await db.todo.create({ data })
  return json(todo)
}
```

### Live Queries

TanStack DB supports live queries that automatically update:

```tsx
import { useLiveQuery } from '@tanstack/db'
import { todosCollection } from '../db/collections'

function TodosList() {
  // Automatically updates when collection changes
  const todos = useLiveQuery(
    todosCollection,
    (collection) => collection.find({ completed: false })
  )

  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}
```

### Filtering and Querying

```tsx
import { useCollectionQuery } from '@tanstack/query-db-collection'
import { todosCollection } from '../db/collections'

function FilteredTodos() {
  const { data: completedTodos } = useCollectionQuery({
    collection: todosCollection,
    filter: (todo) => todo.completed === true,
    sort: (a, b) => b.createdAt - a.createdAt,
  })

  return (
    <div>
      <h2>Completed Todos</h2>
      {completedTodos?.map(todo => (
        <div key={todo.id}>{todo.title}</div>
      ))}
    </div>
  )
}
```

### Offline-First Pattern

```tsx
// The collection automatically handles offline/online sync
import { useCollection } from '@tanstack/db'
import { todosCollection } from '../db/collections'

function OfflineFirstTodos() {
  const collection = useCollection(todosCollection)

  const addTodo = async (title: string) => {
    // Works offline - will sync when online
    await collection.add({
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: Date.now(),
    })
  }

  return (
    <div>
      {/* UI works seamlessly offline/online */}
    </div>
  )
}
```

---

## Deployment

TanStack Start is built on Nitro, allowing deployment to any hosting provider.

### Vercel

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      target: 'vercel',
    }),
  ],
})
```

```bash
# Deploy to Vercel
vercel deploy
```

### Cloudflare Workers/Pages

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      target: 'cloudflare-pages',
    }),
  ],
})
```

```bash
# Build
npm run build

# Deploy
wrangler pages deploy .output/public
```

### AWS (via SST)

```typescript
// sst.config.ts
import { TanstackStart } from 'sst/constructs'

export default {
  config() {
    return {
      name: 'my-tanstack-app',
      region: 'us-east-1',
    }
  },
  stacks(app) {
    app.stack(function Site({ stack }) {
      const site = new TanstackStart(stack, 'site', {
        domain: 'myapp.com',
      })

      stack.addOutputs({
        url: site.url,
      })
    })
  },
}
```

```bash
# Deploy
npx sst deploy
```

### Netlify

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      target: 'netlify',
    }),
  ],
})
```

### Node.js Server

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      target: 'node-server',
    }),
  ],
})
```

```bash
# Build
npm run build

# Run production server
node .output/server/index.mjs
```

### Build for Production

```bash
# Build the application
npm run build

# Preview production build locally
npm run preview
```

---

## Best Practices

### 1. Project Organization

```
src/
├── routes/              # File-based routes
│   ├── __root.tsx
│   ├── index.tsx
│   └── api/
├── components/          # Reusable UI components
│   ├── ui/             # Base components (buttons, inputs)
│   └── features/       # Feature-specific components
├── hooks/              # Custom React hooks
├── lib/                # Utilities and helpers
├── db/                 # Database schemas and collections
├── middleware/         # Server middleware
└── types/              # TypeScript types
```

### 2. Type Safety

Always use TypeScript and leverage type inference:

```tsx
// Define shared types
// src/types/index.ts
export interface User {
  id: string
  name: string
  email: string
}

// Use in server functions
const getUser = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }): Promise<User> => {
    return await db.users.findById(id)
  })

// Type-safe in components
function UserProfile() {
  const user = Route.useLoaderData() // TypeScript knows this is User
  return <div>{user.name}</div>
}
```

### 3. Data Loading Strategy

- Use **loaders** for initial page data
- Use **TanStack Query** for dynamic/refetchable data
- Use **server functions** for mutations

```tsx
export const Route = createFileRoute('/posts')({
  // Initial load on server
  loader: async () => await getInitialPosts(),
  component: PostsPage,
})

function PostsPage() {
  const initialPosts = Route.useLoaderData()

  // Dynamic data with refetching
  const { data: posts } = useQuery({
    queryKey: ['posts'],
    queryFn: getPosts,
    initialData: initialPosts,
  })

  // Mutations
  const mutation = useMutation({
    mutationFn: createPost,
  })

  return <div>{/* UI */}</div>
}
```

### 4. Error Handling

Provide error boundaries at multiple levels:

```tsx
// Global error boundary in __root.tsx
export const Route = createRootRoute({
  errorComponent: GlobalError,
})

// Route-specific errors
export const Route = createFileRoute('/posts')({
  errorComponent: PostsError,
})

// Component-level error boundaries for critical sections
<ErrorBoundary fallback={<ErrorUI />}>
  <CriticalComponent />
</ErrorBoundary>
```

### 5. Performance Optimization

```tsx
// Prefetch on intent
<Link to="/posts" preload="intent">Posts</Link>

// Selective SSR
export const Route = createFileRoute('/dashboard')({
  ssr: 'data-only', // Fetch data on server, render on client
})

// Code splitting
const HeavyComponent = lazy(() => import('./HeavyComponent'))

<Suspense fallback={<Loading />}>
  <HeavyComponent />
</Suspense>
```

### 6. Authentication Pattern

```tsx
// src/middleware/auth.ts
const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await getSession(request)
  if (!session) {
    throw redirect({ to: '/login' })
  }
  return next({ context: { user: session.user } })
})

// Protected layout route
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ request }) => {
    const user = await getCurrentUser(request)
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
})

// Child routes automatically protected
export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})
```

### 7. Environment Variables

```tsx
// Server-side only
const apiKey = process.env.API_KEY // Never sent to client

// Client-safe (prefix with VITE_)
const publicUrl = import.meta.env.VITE_PUBLIC_URL
```

### 8. Database Access

```tsx
// NEVER import database client in client code
// ❌ Bad: db imported in component
import { db } from './db'
function MyComponent() {
  const data = db.query() // ERROR: db is server-only
}

// ✅ Good: Use server functions
const getData = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { db } = await import('./db') // Server-only import
    return db.query()
  })
```

### 9. Avoid Over-fetching

```tsx
// Use search params to control data loading
export const Route = createFileRoute('/posts')({
  validateSearch: z.object({
    limit: z.number().default(10),
    offset: z.number().default(0),
  }),
  loader: async ({ search }) => {
    return getPosts({ limit: search.limit, offset: search.offset })
  },
})
```

### 10. Testing

```tsx
// Test server functions
import { describe, it, expect } from 'vitest'

describe('getUserData', () => {
  it('should return user data', async () => {
    const result = await getUserData({ data: 'user-123' })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('name')
  })
})

// Test components
import { render, screen } from '@testing-library/react'

it('renders user name', () => {
  render(<UserProfile user={{ name: 'John' }} />)
  expect(screen.getByText('John')).toBeInTheDocument()
})
```

---

## Complete Examples

### Example 1: Todo App with TanStack DB

```tsx
// src/db/todos.ts
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: number
}

export const todosCollection = createCollection<Todo>({
  name: 'todos',
  key: 'id',
  storage: { type: 'localStorage', key: 'todos-db' },
})

export const todosQueryOptions = queryCollectionOptions({
  collection: todosCollection,
  queryFn: async () => {
    const res = await fetch('/api/todos')
    return res.json()
  },
  onMutate: async ({ type, data }) => {
    if (type === 'create') {
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    if (type === 'update') {
      await fetch(`/api/todos/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    if (type === 'delete') {
      await fetch(`/api/todos/${data.id}`, { method: 'DELETE' })
    }
  },
})
```

```tsx
// src/routes/todos.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useCollection } from '@tanstack/db'
import { useCollectionQuery } from '@tanstack/query-db-collection'
import { todosCollection, todosQueryOptions, type Todo } from '../db/todos'
import { useState } from 'react'

export const Route = createFileRoute('/todos')({
  component: TodosPage,
})

function TodosPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const { data: allTodos } = useCollectionQuery(todosQueryOptions)
  const collection = useCollection(todosCollection)

  const filteredTodos = allTodos?.filter(todo => {
    if (filter === 'active') return !todo.completed
    if (filter === 'completed') return todo.completed
    return true
  })

  const addTodo = async (title: string) => {
    await collection.add({
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: Date.now(),
    })
  }

  const toggleTodo = async (id: string) => {
    const todo = await collection.get(id)
    if (todo) {
      await collection.update(id, { completed: !todo.completed })
    }
  }

  const deleteTodo = async (id: string) => {
    await collection.delete(id)
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Todos</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement
          if (input.value.trim()) {
            addTodo(input.value)
            input.value = ''
          }
        }}
        className="mb-8"
      >
        <input
          name="title"
          placeholder="What needs to be done?"
          className="w-full p-3 border rounded"
        />
      </form>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter('all')}
          className={filter === 'all' ? 'font-bold' : ''}
        >
          All
        </button>
        <button
          onClick={() => setFilter('active')}
          className={filter === 'active' ? 'font-bold' : ''}
        >
          Active
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={filter === 'completed' ? 'font-bold' : ''}
        >
          Completed
        </button>
      </div>

      <ul className="space-y-2">
        {filteredTodos?.map(todo => (
          <li key={todo.id} className="flex items-center gap-3 p-3 border rounded">
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
            />
            <span className={todo.completed ? 'line-through flex-1' : 'flex-1'}>
              {todo.title}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="text-red-500 hover:text-red-700"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 text-sm text-gray-600">
        {filteredTodos?.filter(t => !t.completed).length} items left
      </div>
    </div>
  )
}
```

```tsx
// src/routes/api/todos.ts
import { json } from '@tanstack/react-start'

// In-memory storage for demo (use real DB in production)
let todos: Array<{
  id: string
  title: string
  completed: boolean
  createdAt: number
}> = []

export async function GET() {
  return json(todos)
}

export async function POST({ request }: { request: Request }) {
  const data = await request.json()
  todos.push(data)
  return json(data, { status: 201 })
}
```

```tsx
// src/routes/api/todos/$id.ts
import { json } from '@tanstack/react-start'

export async function PUT({ params, request }: { params: { id: string }, request: Request }) {
  const data = await request.json()
  const index = todos.findIndex(t => t.id === params.id)
  if (index !== -1) {
    todos[index] = { ...todos[index], ...data }
    return json(todos[index])
  }
  return json({ error: 'Not found' }, { status: 404 })
}

export async function DELETE({ params }: { params: { id: string } }) {
  todos = todos.filter(t => t.id !== params.id)
  return json({ success: true })
}
```

### Example 2: Blog with Authentication

```tsx
// src/middleware/auth.ts
import { createMiddleware } from '@tanstack/react-start'

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const sessionToken = request.headers.get('cookie')?.match(/session=([^;]+)/)?.[1]

  if (!sessionToken) {
    throw new Error('Unauthorized')
  }

  const user = await verifySession(sessionToken)

  return next({
    context: { user },
  })
})
```

```tsx
// src/routes/_authenticated.tsx
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ request }) => {
    const user = await getCurrentUser(request)
    if (!user) {
      throw redirect({ to: '/login' })
    }
    return { user }
  },
  component: () => <Outlet />,
})
```

```tsx
// src/routes/_authenticated/blog/new.tsx
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useForm } from '@tanstack/react-form'
import { authMiddleware } from '../../../middleware/auth'

const createPost = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((data: { title: string; content: string }) => data)
  .handler(async ({ data, context }) => {
    const post = await db.posts.create({
      ...data,
      authorId: context.user.id,
    })
    return post
  })

export const Route = createFileRoute('/_authenticated/blog/new')({
  component: NewPostPage,
})

function NewPostPage() {
  const navigate = Route.useNavigate()

  const form = useForm({
    defaultValues: {
      title: '',
      content: '',
    },
    onSubmit: async ({ value }) => {
      const post = await createPost({ data: value })
      navigate({ to: '/blog/$id', params: { id: post.id } })
    },
  })

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Create New Post</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
      >
        <form.Field name="title">
          {(field) => (
            <div className="mb-4">
              <label className="block mb-2">Title</label>
              <input
                className="w-full p-2 border rounded"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <form.Field name="content">
          {(field) => (
            <div className="mb-4">
              <label className="block mb-2">Content</label>
              <textarea
                className="w-full p-2 border rounded h-64"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <button
          type="submit"
          className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
        >
          Publish
        </button>
      </form>
    </div>
  )
}
```

---

## Additional Resources

### Official Documentation
- **TanStack Start**: https://tanstack.com/start/latest/docs/framework/react/overview
- **TanStack Router**: https://tanstack.com/router/latest/docs/framework/react/overview
- **TanStack Query**: https://tanstack.com/query/latest/docs/framework/react/overview
- **TanStack Form**: https://tanstack.com/form/latest/docs/framework/react/overview
- **TanStack DB**: https://tanstack.com/db/latest/docs/overview

### Community Resources
- **GitHub Repository**: https://github.com/TanStack/router
- **Discord Community**: https://discord.com/invite/tanstack
- **Twitter**: @tannerlinsley

### Starter Templates
- **react-tanstarter**: https://github.com/dotnize/react-tanstarter
- **tanstack-start-dashboard**: https://github.com/Kiranism/tanstack-start-dashboard
- **tss-app**: https://github.com/ally-ahmed/tss-app

### Tutorials
- LogRocket: Full-stack app with TanStack Start
- Frontend Masters: TanStack Router course
- Various Medium articles and blog posts

---

## Conclusion

TanStack Start provides a modern, type-safe, full-stack framework for React applications with:

- **File-based routing** powered by TanStack Router
- **Server functions** for type-safe RPC
- **SSR and streaming** for optimal performance
- **Seamless integration** with TanStack Query, Form, Table, and DB
- **Deploy anywhere** via Nitro
- **Local-first** capabilities with TanStack DB

Start building your next full-stack application with TanStack Start today!
