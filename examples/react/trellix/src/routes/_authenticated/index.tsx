import { createFileRoute, redirect } from "@tanstack/react-router"
import { boardCollection } from "@/lib/collections"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute(`/_authenticated/`)({
  component: IndexPage,
  ssr: false,
  beforeLoad: async () => {
    const res = await authClient.getSession()
    if (!res.data?.session) {
      throw redirect({
        to: `/login`,
        search: {
          redirect: location.href,
        },
      })
    }
  },
  loader: async () => {
    await boardCollection.preload()
    return null
  },
})

function IndexPage() {
  return null
}
