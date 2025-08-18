import type { Collection } from '@tanstack/db'

// Electric-compatible message types
export type ElectricOperation = 'insert' | 'update' | 'delete'
export type ElectricControl = 'up-to-date' | 'must-refetch'

export interface ElectricMessageHeaders {
  operation?: ElectricOperation
  control?: ElectricControl
  lsn?: string
  op_position?: string
  last?: boolean
  txids?: string[]
}

export interface ElectricMessage {
  headers: ElectricMessageHeaders
  key?: string
  value?: Record<string, any>
  old_value?: Record<string, any>
}

// Offset format: "v_seq" where v is version number, seq is always 0
export type Offset = string

// Version index types
export type PK = string | number
export type ChangeOp = 'insert' | 'update' | 'delete'

export interface PKMeta {
  version: number
  deleted: boolean
}

export interface VersionLogEntry {
  pk: PK
  op: ChangeOp
}

export interface ChangeEvent {
  v: number
  pk: PK
  op: ChangeOp
}

// Event bus types
export type ChangeListener = (event: ChangeEvent) => void

// Handler configuration
export interface SyncEndpoint {
  collection: Collection<any, any>
  pageSize?: number
  liveTimeoutMs?: number
}

// Registry types
export interface ShapeHandle {
  id: string
  createdAt: number
}

// Response headers
export interface ElectricHeaders {
  'electric-offset': string
  'electric-handle': string
  'electric-up-to-date'?: string
}