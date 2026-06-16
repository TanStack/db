import { createFileRoute, redirect } from '@tanstack/react-router'
import { projectCollection, todoCollection } from '@/lib/collections'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute(`/_authenticated/`)({
  component: () => null,
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

    await projectCollection.preload()
    await todoCollection.preload()

    const projects = projectCollection.toArray
    if (projects.length === 0) {
      const id = Math.floor(Math.random() * 100000)
      const tx = projectCollection.insert({
        id,
        name: `Default`,
        description: `Default project`,
        owner_id: res.data.user.id,
        shared_user_ids: [],
        created_at: new Date(),
        updated_at: new Date(),
      })
      await tx.isPersisted.promise
      const serverProjectId = projectCollection.toArray[0].id
      throw redirect({
        to: `/project/$projectId`,
        params: { projectId: serverProjectId.toString() },
        replace: true,
      })
    }

    throw redirect({
      to: `/project/$projectId`,
      params: { projectId: projects[0].id.toString() },
      replace: true,
    })
  },
})
