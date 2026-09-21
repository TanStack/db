import { InvalidSyncPersistenceCapabilityError } from './errors'
import type { SyncPersistenceCapabilityV1 } from './types'

export const SYNC_PERSISTENCE_PROTOCOL =
  `@tanstack/db/sync-persistence` as const
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
 * adapter uses it. Undefined means that the collection has no persistence
 * capability; any advertised capability must be complete.
 */
export function validateSyncPersistenceCapability<
  TKey extends string | number = string | number,
>(value: unknown): SyncPersistenceCapabilityV1<TKey> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    throw new InvalidSyncPersistenceCapabilityError(`expected an object`)
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
