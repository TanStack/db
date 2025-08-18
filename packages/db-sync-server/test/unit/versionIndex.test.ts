import { describe, it, expect, beforeEach } from 'vitest'
import { VersionIndex } from '../../src/core/versionIndex'

describe('VersionIndex', () => {
  let versionIndex: VersionIndex

  beforeEach(() => {
    versionIndex = new VersionIndex()
  })

  describe('initial state', () => {
    it('should start with version 0', () => {
      expect(versionIndex.version).toBe(0)
      expect(versionIndex.head).toBe('0_0')
    })

    it('should have empty stats', () => {
      const stats = versionIndex.getStats()
      expect(stats.currentVersion).toBe(0)
      expect(stats.pkCount).toBe(0)
      expect(stats.logEntryCount).toBe(0)
    })
  })

  describe('recordChange', () => {
    it('should increment version on each change', () => {
      versionIndex.recordChange('pk1', 'insert')
      expect(versionIndex.version).toBe(1)
      expect(versionIndex.head).toBe('1_0')

      versionIndex.recordChange('pk2', 'update')
      expect(versionIndex.version).toBe(2)
      expect(versionIndex.head).toBe('2_0')
    })

    it('should track PK metadata correctly', () => {
      versionIndex.recordChange('pk1', 'insert')
      const meta = versionIndex.getPKMeta('pk1')
      expect(meta).toEqual({ version: 1, deleted: false })

      versionIndex.recordChange('pk1', 'delete')
      const meta2 = versionIndex.getPKMeta('pk1')
      expect(meta2).toEqual({ version: 2, deleted: true })
    })

    it('should track deletion state', () => {
      versionIndex.recordChange('pk1', 'insert')
      expect(versionIndex.isDeleted('pk1')).toBe(false)

      versionIndex.recordChange('pk1', 'delete')
      expect(versionIndex.isDeleted('pk1')).toBe(true)
    })
  })

  describe('changesAfter', () => {
    it('should return changes after a specific offset', () => {
      versionIndex.recordChange('pk1', 'insert')
      versionIndex.recordChange('pk2', 'update')
      versionIndex.recordChange('pk3', 'delete')

      const changes = Array.from(versionIndex.changesAfter('0_0'))
      expect(changes).toHaveLength(3)
      expect(changes[0]).toEqual({ v: 1, pk: 'pk1', op: 'insert' })
      expect(changes[1]).toEqual({ v: 2, pk: 'pk2', op: 'update' })
      expect(changes[2]).toEqual({ v: 3, pk: 'pk3', op: 'delete' })
    })

    it('should return empty for offset at head', () => {
      versionIndex.recordChange('pk1', 'insert')
      const changes = Array.from(versionIndex.changesAfter('1_0'))
      expect(changes).toHaveLength(0)
    })

    it('should return empty for future offset', () => {
      versionIndex.recordChange('pk1', 'insert')
      const changes = Array.from(versionIndex.changesAfter('5_0'))
      expect(changes).toHaveLength(0)
    })
  })

  describe('hasChangesAfter', () => {
    it('should return true when there are changes', () => {
      versionIndex.recordChange('pk1', 'insert')
      expect(versionIndex.hasChangesAfter('0_0')).toBe(true)
    })

    it('should return false when caught up', () => {
      versionIndex.recordChange('pk1', 'insert')
      expect(versionIndex.hasChangesAfter('1_0')).toBe(false)
    })

    it('should return false for future offset', () => {
      versionIndex.recordChange('pk1', 'insert')
      expect(versionIndex.hasChangesAfter('5_0')).toBe(false)
    })
  })

  describe('scanSnapshot', () => {
    it('should backfill metadata for existing rows', () => {
      // Mock collection with existing data
      const mockCollection = {
        forEach: (callback: (row: any, pk: string) => void) => {
          callback({ id: 'pk1', name: 'test1' }, 'pk1')
          callback({ id: 'pk2', name: 'test2' }, 'pk2')
        }
      }

      const snapshot = Array.from(versionIndex.scanSnapshot(mockCollection))
      expect(snapshot).toHaveLength(2)
      expect(snapshot[0]).toEqual(['pk1', { id: 'pk1', name: 'test1' }])
      expect(snapshot[1]).toEqual(['pk2', { id: 'pk2', name: 'test2' }])

      // Check that metadata was backfilled
      expect(versionIndex.getPKMeta('pk1')).toEqual({ version: 0, deleted: false })
      expect(versionIndex.getPKMeta('pk2')).toEqual({ version: 0, deleted: false })
    })
  })
})