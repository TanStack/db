import { InvalidSyncPersistenceCapabilityError } from './errors'
import type { SyncPersistenceCapabilityV1 } from './types'

/**
 * @internal
 * Unstable cross-package protocol for persistence-aware collection adapters.
 * Application code should not construct or depend on this value directly.
 */
export const SYNC_PERSISTENCE_PROTOCOL =
  `@tanstack/db/sync-persistence` as const
/** @internal See {@link SYNC_PERSISTENCE_PROTOCOL}. */
export const SYNC_PERSISTENCE_VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function requireFunction(
  value: Record<string, unknown>,
  key: string,
  path = key,
): void {
  if (typeof value[key] !== `function`) {
    throw new InvalidSyncPersistenceCapabilityError(
      `${path} must be a function`,
    )
  }
}

/**
 * Validates the cross-package structural persistence protocol before a sync
 * adapter uses it. Null explicitly means that the collection has no
 * persistence capability; undefined means a wrapper dropped the required
 * field. Any advertised capability must be complete.
 *
 * @internal This is adapter infrastructure, not an application API.
 */
export function validateSyncPersistenceCapability<
  TKey extends string | number = string | number,
>(value: unknown): SyncPersistenceCapabilityV1<TKey> | null {
  if (value === null) return null
  if (!isRecord(value)) {
    throw new InvalidSyncPersistenceCapabilityError(
      `expected null or a complete capability object`,
    )
  }
  if (value.protocol !== SYNC_PERSISTENCE_PROTOCOL) {
    throw new InvalidSyncPersistenceCapabilityError(
      `protocol must be "${SYNC_PERSISTENCE_PROTOCOL}"`,
    )
  }
  if (value.version !== SYNC_PERSISTENCE_VERSION) {
    throw new InvalidSyncPersistenceCapabilityError(
      `version must be ${SYNC_PERSISTENCE_VERSION}`,
    )
  }
  requireFunction(value, `hydrateBaseline`)
  requireFunction(value, `scanPersistedRows`)

  const resumeSnapshot = value.resumeSnapshot
  if (!isRecord(resumeSnapshot)) {
    throw new InvalidSyncPersistenceCapabilityError(
      `resumeSnapshot must be an object`,
    )
  }
  requireFunction(resumeSnapshot, `certify`, `resumeSnapshot.certify`)
  requireFunction(
    resumeSnapshot,
    `getKeySetEvidence`,
    `resumeSnapshot.getKeySetEvidence`,
  )
  requireFunction(
    resumeSnapshot,
    `expectCurrentCommit`,
    `resumeSnapshot.expectCurrentCommit`,
  )

  return value as SyncPersistenceCapabilityV1<TKey>
}
