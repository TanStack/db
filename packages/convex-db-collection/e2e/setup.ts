import { startLocalBackend } from './local-backend'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  interface ProvidedContext {
    convexUrl: string
  }
}

/** Own a dedicated local backend for the test run. Never select a cloud project. */
export default async function setup(project: TestProject) {
  const backend = await startLocalBackend(
    new URL(`./backend/`, import.meta.url),
    process.env.CONVEX_TEST_PORT === undefined
      ? undefined
      : Number(process.env.CONVEX_TEST_PORT),
  )
  project.provide(`convexUrl`, backend.url)
  return backend.stop
}
