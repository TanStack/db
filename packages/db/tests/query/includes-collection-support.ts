// Shared fixtures and facade assertions for the Collection-valued include tests:
// the parent and child rows, the controlled Collection wrapper, and the
// observation helpers. The laws are owned by includes-collection-oracle.property.test.ts.
import { expect } from 'vitest'
import { createControlledCollection as createOracleControlledCollection } from './includes-oracle-helpers.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'

export type ParentRow = {
  id: number
  group: number
}

export type ChildRow = {
  id: number
  parentGroup: number
  value: number
}

export function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
): ControlledCollection<T> {
  return createOracleControlledCollection(name, initialData, {
    autoIndex: `eager`,
    rowUpdateMode: `full`,
  })
}

export function expectedMaterializations<T>(rows: ReadonlyArray<T>) {
  return {
    facade: [...rows],
    array: [...rows],
    materialized: [...rows],
  }
}

export type DeleteIdentityObservation = {
  type: string
  key: unknown
  id: number
  matchesPublishedFacade: boolean
}

export function assertDeleteIdentityEvents(
  events: ReadonlyArray<DeleteIdentityObservation>,
  deleted: boolean,
): void {
  expect(events).toEqual(
    deleted
      ? [
          {
            type: `delete`,
            key: 1,
            id: 1,
            matchesPublishedFacade: true,
          },
        ]
      : [],
  )
}

export function assertRetiredFacade(observation: {
  status: string | undefined
  rows: Array<ChildRow> | undefined
}): void {
  expect(observation).toEqual({ status: `ready`, rows: [] })
}

export type FacadeRootSnapshot = {
  group: number | undefined
  usesOldFacade: boolean
  rows: Array<string | number>
}

export function assertFacadeRootSnapshots(
  snapshots: Array<FacadeRootSnapshot>,
): void {
  expect(snapshots).toEqual([{ group: 2, usesOldFacade: false, rows: [20] }])
}
