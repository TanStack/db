// Receiving environment only: each law, grammar, and judgment comes from its
// primary owner. OPFS supplies real persisted scheduling for Query/TrailBase;
// the reload receivers remain unwrapped so persistence cannot mask selection.
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { observePersistedPrecedence } from '../../query-db-collection/tests/persisted-precedence-driver'
import {
  observeCachedPeerClaim,
  observeRetainedScopedHydration,
} from '../../query-db-collection/tests/retained-scoped-hydration-driver'
import {
  cachedPeerClaimHistories,
  cachedPeerClaimReached,
  cachedPeerClaimStates,
  cachedPeerClaimViolations,
  scopedHydrationHistories,
  scopedHydrationReached,
  scopedHydrationStates,
  scopedHydrationViolations,
} from '../../query-db-collection/tests/retained-scoped-hydration-oracle'
import {
  precedenceHistories,
  precedenceReached,
  precedenceStates,
  precedenceViolations,
} from '../../query-db-collection/tests/persisted-precedence-oracle'
import { observeHydrationLifecycle } from '../../trailbase-db-collection/tests/lifecycle-hydration-driver'
import {
  hydrationLifecycleHistories,
  hydrationLifecycleStates,
  hydrationLifecycleViolations,
} from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import {
  eagerReloadHistories,
  eagerReloadReached,
  eagerReloadStates,
  eagerReloadViolations,
} from '../../db-adapter-conformance/tests/eager-reload-oracle'
import { observeEagerReload } from '../../db-adapter-conformance/tests/eager-reload-driver'
import { rxdbEagerReloadAdapter } from '../../rxdb-db-collection/tests/eager-reload-driver'
import { powerSyncBrowserEagerReloadAdapter } from '../../powersync-db-collection/tests/eager-reload-browser'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'

export type EagerGapResult = {
  results: Array<{ owner: string; history: unknown; violations: Array<string> }>
  reach: Record<string, Record<string, number>>
  artifacts: Array<string>
  error?: string
}
declare global {
  interface Window {
    __eagerGapConformance?: EagerGapResult
  }
}
const result: EagerGapResult = { results: [], reach: {}, artifacts: [] }
function counter(owner: string, states: ReadonlyArray<string>) {
  const counts = Object.fromEntries(states.map((state) => [state, 0]))
  result.reach[owner] = counts
  return (reached: Array<string>) => {
    for (const state of reached) counts[state] = (counts[state] ?? 0) + 1
  }
}
async function database<T>(
  name: string,
  body: (p: PersistedCollectionPersistence) => Promise<T>,
): Promise<T> {
  await removeStartupOPFSArtifacts(name)
  const db = await openBrowserWASQLiteOPFSDatabase({ databaseName: name })
  return withOracleCleanup(
    () => body(createBrowserWASQLitePersistence({ database: db })),
    [() => db.close?.(), () => removeStartupOPFSArtifacts(name)],
  )
}
async function removeReloadFiles() {
  // This page owns an isolated Playwright origin and these SDK fixture names.
  const root =
    (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
      keys: () => AsyncIterableIterator<string>
    }
  for await (const name of root.keys())
    if (name.startsWith(`powersync-eager-reload-`))
      await root.removeEntry(name, { recursive: true })
  await removeStartupOPFSArtifacts(`ps-gap-closed.sqlite`)
}
async function run() {
  try {
    const queryReach = counter(`query`, precedenceStates)
    for (const [i, h] of precedenceHistories.entries()) {
      const observed = await database(`ps-gap-query-${i}.sqlite`, (p) =>
        observePersistedPrecedence(
          p,
          h,
          `query-gap-${i}`,
          inProcessSeams.holdFirstRowSnapshot,
        ),
      )
      queryReach(precedenceReached(h))
      result.results.push({
        owner: `query`,
        history: h,
        violations: precedenceViolations(h, observed),
      })
    }
    const scopedReach = counter(`query-scoped`, scopedHydrationStates)
    for (const [i, h] of scopedHydrationHistories.entries()) {
      const observed = await database(`ps-gap-scoped-${i}.sqlite`, (p) =>
        observeRetainedScopedHydration(p, h, `query-scoped-gap-${i}`),
      )
      scopedReach(scopedHydrationReached(h))
      result.results.push({
        owner: `query-scoped`,
        history: h,
        violations: scopedHydrationViolations(h, observed),
      })
    }
    const claimReach = counter(`query-cached-claim`, cachedPeerClaimStates)
    for (const [i, h] of cachedPeerClaimHistories.entries()) {
      const observed = await database(`ps-gap-claim-${i}.sqlite`, (p) =>
        observeCachedPeerClaim(p, h, `query-claim-gap-${i}`),
      )
      claimReach(cachedPeerClaimReached(h))
      result.results.push({
        owner: `query-cached-claim`,
        history: h,
        violations: cachedPeerClaimViolations(h, observed),
      })
    }
    const trailReach = counter(`trailbase`, hydrationLifecycleStates)
    for (const [i, h] of hydrationLifecycleHistories.entries()) {
      const observed = await database(`ps-gap-trail-${i}.sqlite`, (p) =>
        observeHydrationLifecycle(p, h, `trail-gap-${i}`),
      )
      trailReach(observed.reached)
      result.results.push({
        owner: `trailbase`,
        history: h,
        violations: hydrationLifecycleViolations(h, observed),
      })
    }
    for (const [owner, adapter] of [
      [`rxdb`, rxdbEagerReloadAdapter],
      [`powersync`, powerSyncBrowserEagerReloadAdapter],
    ] as const) {
      const reach = counter(owner, eagerReloadStates)
      for (const [i, h] of eagerReloadHistories.entries()) {
        const observed = await observeEagerReload(
          adapter,
          h,
          `${owner}-gap-${i}`,
          () => reach(eagerReloadReached(h)),
        )
        result.results.push({
          owner,
          history: h,
          violations: eagerReloadViolations(h, observed),
        })
        await removeReloadFiles()
      }
    }
    for (const [owner, counts] of Object.entries(result.reach)) {
      console.info(`${owner}.browser-gap`, JSON.stringify(counts))
      for (const [state, count] of Object.entries(counts))
        if (count === 0) throw new Error(`${owner} did not reach ${state}`)
    }
    result.artifacts = await startupOPFSArtifacts()
  } catch (error) {
    result.error = error instanceof Error ? `${error.stack}` : String(error)
  }
  window.__eagerGapConformance = result
}
void run()
