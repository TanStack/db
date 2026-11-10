import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import type { TestProject } from 'vitest/node'

const execFileAsync = promisify(execFile)

// The Supabase project (config.toml and migrations) lives in this package,
// regardless of the directory vitest was launched from.
const PACKAGE_DIR = fileURLToPath(new URL(`..`, import.meta.url))

// Generous enough for a cold CI runner to pull the container images.
const START_TIMEOUT_MS = 600_000
const STOP_TIMEOUT_MS = 120_000

// Realtime warm-up: a freshly started realtime container needs a moment before
// its Postgres replication is fully wired, so the first subscription can miss
// changes. We subscribe to the dedicated e2e_warmup scratch table and upsert
// rows into it until an event is actually delivered, guaranteeing realtime is
// live before any test runs - without ever touching the tables tests read.
const WARMUP_TIMEOUT_MS = 60_000
const WARMUP_ATTEMPTS = 40
const WARMUP_POKE_INTERVAL_MS = 1000

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

// Values published to the e2e test workers via `inject(...)` (see setup.ts).
declare module 'vitest' {
  export interface ProvidedContext {
    supabaseAnonKey: string
    supabaseServiceRoleKey: string
    supabaseUrl: string
  }
}

interface SupabaseStatus {
  API_URL?: string
  ANON_KEY?: string
  SERVICE_ROLE_KEY?: string
}

// The CLI invocation, e.g. `supabase` (default) or `pnpm dlx supabase@2.116.0`.
const cliCommand = (): [string, Array<string>] => {
  const [command, ...args] = (process.env.SUPABASE_CLI ?? `supabase`)
    .split(` `)
    .filter(Boolean)
  return [command ?? `supabase`, args]
}

const runSupabase = (args: Array<string>, timeout: number) => {
  const [command, baseArgs] = cliCommand()
  return execFileAsync(command, [...baseArgs, ...args], {
    cwd: PACKAGE_DIR,
    timeout,
  })
}

// Returns the parsed `supabase status` JSON, or null when no stack is running.
const readStatus = async (): Promise<SupabaseStatus | null> => {
  try {
    const { stdout } = await runSupabase(
      [`status`, `-o`, `json`],
      STOP_TIMEOUT_MS,
    )
    return JSON.parse(stdout.slice(stdout.indexOf(`{`))) as SupabaseStatus
  } catch (error) {
    // A missing CLI binary is a setup problem, not a stopped stack - surface it
    // instead of falling through to a confusing `supabase start`.
    if ((error as NodeJS.ErrnoException).code === `ENOENT`) {
      throw new Error(
        `Could not run the Supabase CLI. Install it, or point SUPABASE_CLI at it (e.g. SUPABASE_CLI="pnpm dlx supabase@2.116.0").`,
      )
    }
    // Non-zero exit (stack not running) or non-JSON output: treat as no stack.
    return null
  }
}

const warmUpRealtime = async (url: string, anonKey: string): Promise<void> => {
  const client = createClient(url, anonKey)
  let received = false

  // Upserts never conflict with rows left over from a previous run of the same
  // stack, and every upsert produces a WAL change (INSERT or UPDATE) for the
  // listener below. supabase-js resolves with { error } instead of throwing.
  const poke = async (): Promise<void> => {
    for (let attempt = 0; attempt < WARMUP_ATTEMPTS && !received; attempt++) {
      await client.from(`e2e_warmup`).upsert({ id: attempt })
      await delay(WARMUP_POKE_INTERVAL_MS)
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Realtime warm-up timed out; is the realtime container healthy?`,
            ),
          ),
        WARMUP_TIMEOUT_MS,
      )
      client
        .channel(`e2e-warmup`)
        .on(
          `postgres_changes`,
          { event: `*`, schema: `public`, table: `e2e_warmup` },
          () => {
            received = true
            clearTimeout(timer)
            resolve()
          },
        )
        .subscribe((status) => {
          if (status === `SUBSCRIBED`) {
            poke().catch(() => undefined)
          }
        })
    })
  } finally {
    await client.removeAllChannels()
  }
}

export default async function setup({ provide }: TestProject) {
  let startedByUs = false
  let url = process.env.SUPABASE_URL
  let anonKey = process.env.SUPABASE_ANON_KEY
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Only touch Docker when creds were not already supplied by the environment.
  if (!(url && anonKey && serviceRoleKey)) {
    let status = await readStatus()

    if (!status) {
      // Boots only the containers the adapter needs (db, kong, rest, realtime,
      // auth); the rest are disabled in supabase/config.toml.
      await runSupabase([`start`], START_TIMEOUT_MS)
      startedByUs = true
      status = await readStatus()
    }

    if (!(status?.API_URL && status.ANON_KEY && status.SERVICE_ROLE_KEY)) {
      throw new Error(
        `Could not resolve local Supabase credentials. Is Docker running? Try \`supabase start\` in packages/supabase-db-collection.`,
      )
    }

    url = status.API_URL
    anonKey = status.ANON_KEY
    serviceRoleKey = status.SERVICE_ROLE_KEY
  }

  // Confirm realtime is actually delivering before tests rely on it.
  await warmUpRealtime(url, anonKey)

  provide(`supabaseUrl`, url)
  provide(`supabaseAnonKey`, anonKey)
  provide(`supabaseServiceRoleKey`, serviceRoleKey)

  return async () => {
    // Only stop the stack if this setup started it; never tear down a stack the
    // developer (or CI) started separately.
    if (startedByUs) {
      await runSupabase([`stop`], STOP_TIMEOUT_MS)
    }
  }
}
