import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fc } from '@fast-check/vitest'
import { AttachmentTable, Schema, Table, column } from '@powersync/common'
import { NodeFileSystemAdapter, PowerSyncDatabase } from '@powersync/node'
import { createCollection } from '@tanstack/db'
import pDefer from 'p-defer'
import { expect, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import { TanStackDBAttachmentQueue } from '../src/attachments'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type { RemoteStorageAdapter } from '@powersync/common'

const schema = new Schema({
  owners: new Table({ photo_id: column.text }),
  attachments: new AttachmentTable(),
})
const attachmentId = `photo`
const ownerId = `owner`

type Command =
  | `save`
  | `reject-save`
  | `duplicate-warm`
  | `duplicate-cold`
  | `delete`
  | `reject-delete`
  | `start-upload`
  | `finish-upload`
  | `fail-upload`
  | `drain`

export interface History {
  name: string
  commands: Array<Command>
  bytes: Array<number>
}

// This is a user-intent model, not an AttachmentState transition table. An ID
// owns bytes only after save commits. Rejected operations leave intent intact.
// Transport completion cannot alter the most recent committed reference.
interface Model {
  intent: `absent` | `present` | `deleted`
  bytes: Array<number>
}

interface AttachmentRow {
  id: string
  local_uri: string | null
  size: number | null
  state: number
  has_synced: number
}

async function setupOracle() {
  const directory = await mkdtemp(join(tmpdir(), `ps-attachment-oracle-`))
  const db = new PowerSyncDatabase({
    database: {
      dbFilename: `${randomUUID()}.sqlite`,
      dbLocation: directory,
      implementation: TEST_DATABASE_IMPLEMENTATION,
    },
    schema,
  })
  await db.disconnectAndClear()
  const local = new NodeFileSystemAdapter(join(directory, `files`))
  await local.initialize()
  const attachments = createCollection(
    powerSyncCollectionOptions({
      database: db,
      table: schema.props.attachments,
    }),
  )
  const owners = createCollection(
    powerSyncCollectionOptions({ database: db, table: schema.props.owners }),
  )
  await Promise.all([attachments.stateWhenReady(), owners.stateWhenReady()])

  // Only the remote transport is controlled. Local bytes, transactions, SQL,
  // collection delivery, and SDK completion writes all use the real adapters.
  const remote = new Map<string, Array<number>>()
  const io = { uploads: 0, deletes: 0, downloads: 0 }
  let uploadGate:
    | {
        entered: ReturnType<typeof pDefer<void>>
        outcome: ReturnType<typeof pDefer<boolean>>
      }
    | undefined
  let syncing: Promise<void> | undefined
  const transport: RemoteStorageAdapter = {
    async uploadFile(data, attachment) {
      io.uploads++
      const captured = Array.from(new Uint8Array(data))
      const gate = uploadGate
      if (gate) {
        gate.entered.resolve()
        if (!(await gate.outcome.promise))
          throw new Error(`injected upload failure`)
      }
      remote.set(attachment.id, captured)
    },
    deleteFile(attachment) {
      io.deletes++
      remote.delete(attachment.id)
      return Promise.resolve()
    },
    downloadFile() {
      io.downloads++
      throw new Error(`download is outside this save/delete history`)
    },
  }
  const queue = new TanStackDBAttachmentQueue({
    db,
    attachmentsCollection: attachments,
    localStorage: local,
    remoteStorage: transport,
    // These histories exercise explicit save/delete intent. Watcher lifecycle
    // has its own boundary tests; no periodic timer can race our schedule.
    watchAttachments: () => {},
    archivedCacheLimit: 0,
  })
  // Track actual destinations, including writes whose transaction later fails.
  // A fixed ID-derived filename would miss orphaned call-owned files.
  const writtenFiles = new Set<string>()
  const saveFile = local.saveFile.bind(local)
  vi.spyOn(local, `saveFile`).mockImplementation((path, data) => {
    writtenFiles.add(path)
    return saveFile(path, data)
  })
  let uri: string | undefined

  async function finishUpload(succeeds: boolean) {
    if (!uploadGate || !syncing) throw new Error(`no upload in flight`)
    uploadGate.outcome.resolve(succeeds)
    await syncing
    syncing = undefined
    uploadGate = undefined
  }

  async function assertObserved(model: Model, label: string, drained: boolean) {
    const rows = await db.getAll<AttachmentRow>(
      `SELECT id, local_uri, size, state, has_synced FROM attachments ORDER BY id`,
    )
    const references = await db.getAll<{ id: string; photo_id: string | null }>(
      `SELECT id, photo_id FROM owners ORDER BY id`,
    )
    // SQL is authoritative; collection convergence is an additional assertion,
    // never the source of the oracle's expected reference or expected bytes.
    await vi.waitFor(
      () => {
        expect(
          attachments.toArray.map(
            ({ id, local_uri, size, state, has_synced }) => ({
              id,
              local_uri,
              size,
              state,
              has_synced,
            }),
          ),
          label,
        ).toEqual(rows)
        expect(
          owners.toArray.map(({ id, photo_id }) => ({ id, photo_id })),
          label,
        ).toEqual(references)
      },
      { timeout: 3000, interval: 10 },
    )
    const exists = uri !== undefined && (await local.fileExists(uri))
    for (const path of writtenFiles) {
      if (
        path !== uri ||
        model.intent === `absent` ||
        (drained && model.intent === `deleted`)
      ) {
        expect(
          await local.fileExists(path),
          `${label}: unexpected file ${path}`,
        ).toBe(false)
      }
    }
    const observed = {
      references,
      localBytes: exists
        ? Array.from(new Uint8Array(await local.readFile(uri!)))
        : null,
      remoteBytes: remote.get(attachmentId) ?? null,
      rows,
    }
    const evidence = `${label}; I/O=${JSON.stringify(io)}`
    expect(references, label).toEqual(
      model.intent === `absent`
        ? []
        : [
            {
              id: ownerId,
              photo_id: model.intent === `present` ? attachmentId : null,
            },
          ],
    )
    // This is a logical FK: PowerSync's synced table views do not enforce a
    // SQLite FOREIGN KEY. An attached owner must still resolve to its own row.
    if (model.intent === `present`) {
      expect(observed, evidence).toMatchObject({
        localBytes: model.bytes,
        rows: [{ id: attachmentId, local_uri: uri, size: model.bytes.length }],
      })
      if (drained) expect(observed.remoteBytes, label).toEqual(model.bytes)
    } else if (model.intent === `absent` || drained) {
      expect(observed, evidence).toMatchObject({
        localBytes: null,
        remoteBytes: null,
        rows: [],
      })
    }
    // If remote bytes exist at an intermediate boundary, they must come from
    // the accepted save, never the rejected duplicate (same size, other bytes).
    if (observed.remoteBytes)
      expect(observed.remoteBytes, label).toEqual(model.bytes)
  }

  async function run(command: Command, model: Model) {
    switch (command) {
      case `save`:
      case `reject-save`: {
        const saving = queue.save({
          id: attachmentId,
          fileExtension: `bin`,
          data: new Uint8Array(model.bytes).buffer,
          updateHook: (attachment) => {
            owners.insert({ id: ownerId, photo_id: attachment.id })
            if (command === `reject-save`)
              throw new Error(`injected hook failure`)
          },
        })
        if (command === `reject-save`) {
          await expect(saving).rejects.toThrow(`injected hook failure`)
        } else {
          const saved = await saving
          uri = saved.local_uri ?? undefined
          model.intent = `present`
        }
        break
      }
      case `duplicate-warm`:
      case `duplicate-cold`: {
        const collection =
          command === `duplicate-cold`
            ? createCollection(
                powerSyncCollectionOptions({
                  database: db,
                  table: schema.props.attachments,
                }),
              )
            : attachments
        const duplicateQueue = new TanStackDBAttachmentQueue({
          db,
          attachmentsCollection: collection,
          localStorage: local,
          remoteStorage: transport,
          watchAttachments: () => {},
        })
        try {
          if (command === `duplicate-cold`)
            expect(collection.get(attachmentId)).toBeUndefined()
          await expect(
            duplicateQueue.save({
              id: attachmentId,
              fileExtension: `bin`,
              data: new Uint8Array(model.bytes.map((byte) => byte ^ 255))
                .buffer,
              updateHook: () =>
                owners.update(ownerId, (owner) => {
                  owner.photo_id = null
                }),
            }),
          ).rejects.toThrow()
        } finally {
          await duplicateQueue.stopSync()
          if (collection !== attachments) await collection.cleanup()
        }
        break
      }
      case `delete`:
      case `reject-delete`: {
        const deleting = queue.delete({
          id: attachmentId,
          updateHook: () => {
            owners.update(ownerId, (owner) => {
              owner.photo_id = null
            })
            if (command === `reject-delete`)
              throw new Error(`injected hook failure`)
          },
        })
        if (command === `reject-delete`) {
          await expect(deleting).rejects.toThrow(`injected hook failure`)
        } else {
          await deleting
          model.intent = `deleted`
        }
        break
      }
      case `start-upload`:
        if (syncing) throw new Error(`upload already in flight`)
        uploadGate = { entered: pDefer<void>(), outcome: pDefer<boolean>() }
        syncing = queue.syncStorage()
        await vi.waitFor(() => expect(io.uploads).toBeGreaterThan(0), {
          timeout: 3000,
          interval: 10,
        })
        await uploadGate.entered.promise
        break
      case `finish-upload`:
        await finishUpload(true)
        break
      case `fail-upload`:
        await finishUpload(false)
        break
      case `drain`: {
        if (syncing) throw new Error(`finish the held upload before draining`)
        // No more injected failures: two passes suffice for these single-ID
        // histories. A third tick must be idle, not merely leave SQL detached.
        await queue.syncStorage()
        await queue.syncStorage()
        const settledIO = { ...io }
        await queue.syncStorage()
        expect(io).toEqual(settledIO)
        break
      }
    }
  }

  return {
    run,
    assertObserved,
    async dispose() {
      if (uploadGate) uploadGate.outcome.resolve(true)
      await syncing
      await queue.stopSync()
      await Promise.all([attachments.cleanup(), owners.cleanup()])
      await db.disconnectAndClear()
      await db.close()
      await local.clear()
      await rm(directory, { recursive: true })
    },
  }
}

export async function runHistory(history: History) {
  const fixture = await setupOracle()
  const model: Model = { intent: `absent`, bytes: [...history.bytes] }
  try {
    for (const [index, command] of history.commands.entries()) {
      const label = `${history.name}: step ${index + 1}/${history.commands.length} ${command}; ${JSON.stringify(history)}`
      await fixture.run(command, model)
      await fixture.assertObserved(model, label, command === `drain`)
    }
  } finally {
    await fixture.dispose()
  }
}

export const corpus: Array<Omit<History, `bytes`>> = [
  {
    name: `warm duplicate preserves bytes and reference`,
    commands: [`save`, `duplicate-warm`, `drain`],
  },
  {
    name: `cold duplicate preserves bytes and reference`,
    commands: [`save`, `duplicate-cold`, `drain`],
  },
  {
    name: `delete before upload removes local data`,
    commands: [`save`, `delete`, `drain`],
  },
  {
    name: `delete during successful upload removes remote data`,
    commands: [`save`, `start-upload`, `delete`, `finish-upload`, `drain`],
  },
  {
    name: `delete after upload removes remote data`,
    commands: [`save`, `start-upload`, `finish-upload`, `delete`, `drain`],
  },
  {
    name: `delete during failed upload does not retry obsolete intent`,
    commands: [`save`, `start-upload`, `delete`, `fail-upload`, `drain`],
  },
  {
    name: `upload failure retries accepted bytes`,
    commands: [`save`, `start-upload`, `fail-upload`, `drain`],
  },
  {
    name: `delete after upload failure removes local data`,
    commands: [`save`, `start-upload`, `fail-upload`, `delete`, `drain`],
  },
  {
    name: `save hook failure rolls back both rows and local data`,
    commands: [`reject-save`, `save`, `drain`],
  },
  {
    name: `delete hook failure preserves bytes and reference`,
    commands: [`save`, `reject-delete`, `drain`],
  },
  {
    name: `repeated delete stays deleted`,
    commands: [`save`, `delete`, `delete`, `drain`],
  },
]

// The ordinary suite excludes only the named SDK completion race; the opt-in
// repro suite runs that same law and harness without an expected-failure waiver.
export const sdkCompletionCorpus = corpus.filter(
  ({ commands }) =>
    commands.indexOf(`delete`) > commands.indexOf(`start-upload`) &&
    commands.indexOf(`delete`) <
      Math.max(
        commands.indexOf(`finish-upload`),
        commands.indexOf(`fail-upload`),
      ),
)
export const supportedCorpus = corpus.filter(
  (history) => !sdkCompletionCorpus.includes(history),
)

export function historyArbitrary(includeInFlightDelete: boolean) {
  return fc
    .record({
      bytes: fc.array(fc.integer({ min: 0, max: 255 }), {
        minLength: 1,
        maxLength: 16,
      }),
      duplicate: fc.constantFrom(`none`, `warm`, `cold`),
      deletion: includeInFlightDelete
        ? fc.constantFrom(`never`, `before`, `during`, `after`)
        : fc.constantFrom(`never`, `before`, `after`),
      uploadSucceeds: fc.boolean(),
      rejectDelete: fc.boolean(),
    })
    .map(
      ({
        bytes,
        duplicate,
        deletion,
        uploadSucceeds,
        rejectDelete,
      }): History => {
        const commands: Array<Command> = [`save`]
        if (duplicate === `warm`) commands.push(`duplicate-warm`)
        if (duplicate === `cold`) commands.push(`duplicate-cold`)
        if (rejectDelete) commands.push(`reject-delete`)
        if (deletion === `before`) {
          commands.push(`delete`)
        } else {
          commands.push(`start-upload`)
          if (deletion === `during`) commands.push(`delete`)
          commands.push(uploadSucceeds ? `finish-upload` : `fail-upload`)
          if (deletion === `after`) commands.push(`delete`)
        }
        commands.push(`drain`)
        return { name: `generated`, commands, bytes }
      },
    )
}
