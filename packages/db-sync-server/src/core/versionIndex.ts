import { BTree } from '@tanstack/db'
import type { 
  PK, 
  PKMeta, 
  VersionLogEntry, 
  ChangeEvent, 
  ChangeOp 
} from '../types'
import { formatOffset } from './offsets'

/**
 * Version index for tracking changes to a collection
 * Uses B+Tree from TanStack DB for efficient storage and retrieval
 */
export class VersionIndex {
  private pkIndex: BTree<PK, PKMeta>
  private versionLog: BTree<[number, number], VersionLogEntry>
  private currentVersion: number = 0

  constructor() {
    // PK index: maps PK to latest metadata
    this.pkIndex = new BTree<PK, PKMeta>((a, b) => {
      if (a < b) return -1
      if (a > b) return 1
      return 0
    })
    
    // Version log: maps [version, seq] to change entry (seq always 0)
    this.versionLog = new BTree<[number, number], VersionLogEntry>((a, b) => {
      if (a[0] < b[0]) return -1
      if (a[0] > b[0]) return 1
      if (a[1] < b[1]) return -1
      if (a[1] > b[1]) return 1
      return 0
    })
  }

  /**
   * Get the current version number
   */
  get version(): number {
    return this.currentVersion
  }

  /**
   * Get the head offset (latest version)
   */
  get head(): string {
    return formatOffset(this.currentVersion)
  }

  /**
   * Record a change to the collection
   * @param pk Primary key of the changed row
   * @param op Operation type
   */
  recordChange(pk: PK, op: ChangeOp): void {
    this.currentVersion++
    
    // Update PK metadata
    const meta: PKMeta = {
      version: this.currentVersion,
      deleted: op === 'delete'
    }
    this.pkIndex.set(pk, meta)
    
    // Add to version log
    const logEntry: VersionLogEntry = { pk, op }
    this.versionLog.set([this.currentVersion, 0], logEntry)
  }

  /**
   * Get changes after a specific offset
   * @param offset The offset to get changes after
   * @returns Iterator of change events
   */
  *changesAfter(offset: string): IterableIterator<ChangeEvent> {
    const version = parseInt(offset.split('_')[0], 10)
    
    // Iterate through version log starting after the given version
    const changes: ChangeEvent[] = []
    this.versionLog.forRange(
      [version + 1, 0],
      [Infinity, 0],
      true,
      (key, entry) => {
        const [v, seq] = key
        changes.push({
          v,
          pk: entry.pk,
          op: entry.op
        })
      }
    )
    
    for (const change of changes) {
      yield change
    }
  }

  /**
   * Check if there are changes after a specific offset
   * @param offset The offset to check
   * @returns True if there are changes after the offset
   */
  hasChangesAfter(offset: string): boolean {
    const version = parseInt(offset.split('_')[0], 10)
    
    // Check if there's any entry in version log after the given version
    let hasChanges = false
    this.versionLog.forRange(
      [version + 1, 0],
      [Infinity, 0],
      true,
      () => {
        hasChanges = true
        return { break: true } // Stop after first match
      }
    )
    return hasChanges
  }

  /**
   * Get a snapshot of all current rows (for initial sync)
   * @param collection The collection to scan
   * @returns Iterator of [pk, row] pairs
   */
  *scanSnapshot<T>(collection: any): IterableIterator<[PK, T]> {
    // Backfill PK metadata for existing rows
    const snapshot: [PK, T][] = []
    collection.forEach((row: T, pk: PK) => {
      // Check if we already have metadata for this PK
      const existing = this.pkIndex.get(pk)
      if (!existing) {
        // Add metadata for existing row (version 0 means it existed before tracking)
        this.pkIndex.set(pk, { version: 0, deleted: false })
      }
      snapshot.push([pk, row])
    })
    
    for (const item of snapshot) {
      yield item
    }
  }

  /**
   * Get metadata for a specific PK
   * @param pk Primary key
   * @returns PK metadata or undefined if not found
   */
  getPKMeta(pk: PK): PKMeta | undefined {
    return this.pkIndex.get(pk)
  }

  /**
   * Check if a PK is currently deleted
   * @param pk Primary key
   * @returns True if the PK is marked as deleted
   */
  isDeleted(pk: PK): boolean {
    const meta = this.pkIndex.get(pk)
    return meta?.deleted ?? false
  }

  /**
   * Get statistics about the version index
   */
  getStats() {
    return {
      currentVersion: this.currentVersion,
      pkCount: this.pkIndex.size,
      logEntryCount: this.versionLog.size
    }
  }
}