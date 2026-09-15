import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AttachmentQueue,
  AttachmentState,
  AttachmentTable,
  Schema,
} from '@powersync/common'
import { NodeFileSystemAdapter, PowerSyncDatabase } from '@powersync/node'
import pDefer from 'p-defer'
import { describe, expect, it } from 'vitest'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'

const describePowerSync = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

// No TanStack collection, subclass, transaction, or watcher participates in this
// control. The native SDK alone loses deletion intent in its completion write.
describePowerSync(`native SDK completion contract`, () => {
  it.each([true, false])(
    `keeps deletion queued after upload success=%s`,
    async (succeeds) => {
      const directory = await mkdtemp(join(tmpdir(), `ps-native-completion-`))
      const db = new PowerSyncDatabase({
        database: {
          dbFilename: `attachments.sqlite`,
          dbLocation: directory,
          implementation: TEST_DATABASE_IMPLEMENTATION,
        },
        schema: new Schema({ attachments: new AttachmentTable() }),
      })
      await db.disconnectAndClear()
      const localStorage = new NodeFileSystemAdapter(join(directory, `files`))
      await localStorage.initialize()
      const entered = pDefer<void>()
      const release = pDefer<void>()
      const queue = new AttachmentQueue({
        db,
        localStorage,
        remoteStorage: {
          async uploadFile() {
            entered.resolve()
            await release.promise
            if (!succeeds) throw new Error(`injected upload failure`)
          },
          async deleteFile() {},
          downloadFile() {
            throw new Error(`unexpected download`)
          },
        },
        watchAttachments: () => {},
      })
      let syncing: Promise<void> | undefined
      try {
        const record = await queue.saveFile({
          data: new Uint8Array([0, 7, 128, 255]).buffer,
          fileExtension: `bin`,
        })
        syncing = queue.syncStorage()
        await entered.promise
        await queue.deleteFile({ id: record.id })
        const readState = () =>
          db.get(`SELECT state FROM attachments WHERE id = ?`, [record.id])
        expect(await readState()).toEqual({
          state: AttachmentState.QUEUED_DELETE,
        })
        release.resolve()
        await syncing
        expect(await readState()).toEqual({
          state: AttachmentState.QUEUED_DELETE,
        })
      } finally {
        release.resolve()
        await syncing
        await queue.stopSync()
        await db.disconnectAndClear()
        await db.close()
        await localStorage.clear()
        await rm(directory, { recursive: true })
      }
    },
  )
})
