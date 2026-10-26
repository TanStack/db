import type { SyncConfig } from '../src/types.js'

export type RetainedRow = {
  id: number
  value: number
}

export type SyncActions = Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]
