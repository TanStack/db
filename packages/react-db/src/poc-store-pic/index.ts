/**
 * POC: Store Pic (Concurrent Store) Pattern for TanStack/db
 *
 * This POC demonstrates using React's upcoming concurrent stores pattern
 * (also called "store pic") to make useLiveQuery work properly with
 * React transitions and concurrent features.
 *
 * Based on:
 * - react-concurrent-store ponyfill by Justin Walsh
 * - react-redux PR #2263 by Mark Erikson
 */

export { CollectionStore } from "./CollectionStore"
export type { CollectionSnapshot } from "./CollectionStore"
export { StoreManager } from "./StoreManager"
export {
  useLiveQueryConcurrent,
  CollectionStoreProvider,
} from "./useLiveQueryConcurrent"
export type { UseLiveQueryStatus } from "./useLiveQueryConcurrent"
export { default as Emitter } from "./Emitter"
