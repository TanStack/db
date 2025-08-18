export type { SyncEndpoint } from './types'
export { createSyncHandler } from './server/handler'

// Re-export core types for advanced usage
export type {
  ElectricMessage,
  ElectricOperation,
  ElectricControl,
  Offset,
  PK,
  ChangeOp,
  ChangeEvent,
  ShapeHandle,
  ElectricHeaders
} from './types'

// Re-export core classes for testing/advanced usage
export { VersionIndex } from './core/versionIndex'
export { EventBus } from './core/eventBus'
export { ElectricStreamEncoder } from './core/stream'
export { ShapeHandleRegistry, globalRegistry } from './core/registry'
export {
  parseOffset,
  formatOffset,
  compareOffsets,
  headOffset,
  isValidOffset
} from './core/offsets'