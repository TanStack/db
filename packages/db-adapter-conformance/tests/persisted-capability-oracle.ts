/**
 * An advertised persistence capability is a versioned structural protocol.
 * Missing or malformed required members must fail at sync admission, before a
 * source result can claim successful startup. An absent metadata API and an
 * explicit null capability are legal. Authority: SyncMetadataApi.persistence
 * and sync-persistence.ts's cross-package protocol contract.
 *
 * This independent judgment uses a finite field grammar, not the validator.
 * Each receiver supplies a real SDK and one of the startup storage hosts.
 * The observation is the error returned by actual sync invocation, before
 * source delivery; accepted inputs additionally complete a real source result.
 * This owner checks protocol admission, not row replacement or I/O failure.
 */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { PersistedStartupAdapter } from './persisted-startup-driver'
import type { PersistedStartupHistory } from './persisted-startup-oracle'

const requiredMembers = [
  `protocol`,
  `version`,
  `hydrateBaseline`,
  `reserveCommitTurn`,
  `scanPersistedRows`,
  `resumeSnapshot`,
  `resumeSnapshot.certify`,
  `resumeSnapshot.getKeySetEvidence`,
  `resumeSnapshot.expectCurrentCommit`,
] as const
export type CapabilityHistory =
  | { kind: `complete` | `null` | `absent-metadata` | `missing-capability` }
  | {
      kind: `missing-member` | `malformed-member`
      member: (typeof requiredMembers)[number]
    }
export const capabilityHistories: Array<CapabilityHistory> = [
  { kind: `complete` },
  { kind: `null` },
  { kind: `absent-metadata` },
  { kind: `missing-capability` },
  ...requiredMembers.flatMap((member): Array<CapabilityHistory> => [
    { kind: `missing-member`, member },
    { kind: `malformed-member`, member },
  ]),
]
export const capabilityMustAccept = (h: CapabilityHistory): boolean =>
  h.kind === `complete` || h.kind === `null` || h.kind === `absent-metadata`

// Supply protocol faults at the wrapper-to-source boundary. Never call the
// production validator to decide the expected verdict.
function transformCapability(metadata: unknown, h: CapabilityHistory): unknown {
  if (h.kind === `complete`) return metadata
  if (h.kind === `absent-metadata`) return undefined
  const api = metadata as Record<string, unknown>
  if (h.kind === `null`) return { ...api, persistence: null }
  if (h.kind === `missing-capability`) {
    const { persistence: _removed, ...rest } = api
    return rest
  }
  if (!(`member` in h)) throw new Error(`Missing capability fault member`)
  const capability = { ...(api.persistence as Record<string, unknown>) }
  const [parent, child] = h.member.split(`.`)
  const object = child
    ? { ...(capability[parent!] as Record<string, unknown>) }
    : capability
  const key = child ?? parent!
  if (h.kind === `missing-member`) delete object[key]
  else object[key] = false
  if (child) capability[parent!] = object
  return { ...api, persistence: capability }
}
export function capabilityViolations(
  h: CapabilityHistory,
  error: unknown,
  mustAccept = capabilityMustAccept(h),
): Array<string> {
  const name = error instanceof Error ? error.name : undefined
  if (mustAccept)
    return error === undefined
      ? []
      : [`legal capability rejected: ${String(error)}`]
  return name === `InvalidSyncPersistenceCapabilityError`
    ? []
    : [`invalid capability accepted or wrong error: ${String(error)}`]
}
export async function observeCapability(
  adapter: PersistedStartupAdapter<PersistedStartupHistory>,
  persistence: PersistedCollectionPersistence,
  h: CapabilityHistory,
  id: string,
): Promise<unknown> {
  const source = await adapter.create(
    persistence,
    {
      previous: 0,
      next: 1,
      peer: false,
      response: `after-restore`,
    },
    id,
    (metadata) => transformCapability(metadata, h),
  )
  return withOracleCleanup(async () => {
    const loading = source.collection.preload()
    void loading.catch(() => {})
    if (!source.syncOutcome)
      throw new Error(`Receiver does not record sync admission`)
    const { error } = await source.syncOutcome
    if (error === undefined && capabilityMustAccept(h)) {
      await source.deliver()
      await source.initialResult
      await loading
    }
    return error
  }, [() => source.dispose()])
}
declareOracle({
  model: [capabilityMustAccept],
  grammar: [capabilityHistories],
  check: [capabilityViolations],
})
