import { createFileRoute } from "@tanstack/react-router"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { router } from "@/lib/trpc"
import { boardsRouter } from "@/lib/trpc/boards"
import { columnsRouter } from "@/lib/trpc/columns"
import { itemsRouter } from "@/lib/trpc/items"
import { db } from "@/db/connection"
import { auth } from "@/lib/auth"

export const appRouter = router({
  boards: boardsRouter,
  columns: columnsRouter,
  items: itemsRouter,
})

export type AppRouter = typeof appRouter

const serve = ({ request }: { request: Request }) => {
  return fetchRequestHandler({
    endpoint: `/api/trpc`,
    req: request,
    router: appRouter,
    createContext: async () => ({
      db,
      session: await auth.api.getSession({ headers: request.headers }),
    }),
  })
}

export const Route = createFileRoute(`/api/trpc/$`)({
  server: {
    handlers: {
      GET: serve,
      POST: serve,
    },
  },
})
