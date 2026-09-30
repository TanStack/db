import { describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({
  users: [
    {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      image: null,
      createdAt: '2026-03-01T13:00:00.000Z',
      updatedAt: '2026-03-01T14:00:00.000Z',
    },
  ],
  projects: [
    {
      id: 1,
      name: 'Example',
      description: null,
      shared_user_ids: [],
      created_at: '2026-03-01T13:00:00.000Z',
      owner_id: 'u1',
    },
  ],
  todos: [
    {
      id: 1,
      text: 'Check dates',
      completed: false,
      created_at: '2026-03-01T13:00:00.000Z',
      user_id: 'u1',
      project_id: 1,
      user_ids: ['u1'],
    },
  ],
}))

vi.mock('@/lib/trpc-client', () => ({
  trpc: {
    users: { getAll: { query: async () => rows.users } },
    projects: { getAll: { query: async () => rows.projects } },
    todos: { getAll: { query: async () => rows.todos } },
  },
}))

import {
  projectCollection,
  todoCollection,
  usersCollection,
} from './collections'

describe('project example collections', () => {
  it('loads serialized user timestamps as dates', async () => {
    await usersCollection.preload()

    expect(usersCollection.get('u1')).toMatchObject({
      createdAt: new Date(rows.users[0].createdAt),
      updatedAt: new Date(rows.users[0].updatedAt),
    })
    expect(usersCollection.get('u1')).not.toHaveProperty('created_at')
    expect(usersCollection.get('u1')).not.toHaveProperty('updated_at')
  })

  it('loads project rows from the declared database columns', async () => {
    await projectCollection.preload()

    expect(projectCollection.get(1)?.created_at).toEqual(
      new Date(rows.projects[0].created_at)
    )
    expect(projectCollection.get(1)).not.toHaveProperty('updated_at')
  })

  it('loads todo rows from the declared database columns', async () => {
    await todoCollection.preload()

    expect(todoCollection.get(1)?.created_at).toEqual(
      new Date(rows.todos[0].created_at)
    )
    expect(todoCollection.get(1)).not.toHaveProperty('updated_at')
  })
})
