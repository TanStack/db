import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  vfs: { lastError: null as Error | null },
}))

vi.mock('@journeyapps/wa-sqlite/dist/wa-sqlite.mjs', () => ({
  default: () => Promise.resolve({}),
}))
vi.mock('@journeyapps/wa-sqlite', () => ({
  Factory: () => ({ open_v2: mocks.open, vfs_register: vi.fn() }),
  SQLITE_OPEN_CREATE: 4,
  SQLITE_OPEN_READWRITE: 2,
  SQLITE_OPEN_URI: 64,
}))
vi.mock('@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js', () => ({
  OPFSCoopSyncVFS: { create: () => Promise.resolve(mocks.vfs) },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.resetModules()
  mocks.vfs.lastError = null
})

async function initialize(): Promise<BrowserOPFSWorkerResponse> {
  let receive:
    | ((event: MessageEvent<BrowserOPFSWorkerRequest>) => void)
    | undefined
  vi.stubGlobal(`navigator`, {
    storage: { getDirectory: () => Promise.resolve({}) },
  })
  vi.stubGlobal(`FileSystemFileHandle`, {
    prototype: { createSyncAccessHandle: () => Promise.resolve({}) },
  })
  vi.stubGlobal(
    `addEventListener`,
    (
      _type: string,
      listener: (event: MessageEvent<BrowserOPFSWorkerRequest>) => void,
    ) => {
      receive = listener
    },
  )
  const response = new Promise<BrowserOPFSWorkerResponse>((resolve) => {
    vi.stubGlobal(`postMessage`, resolve)
  })
  await import('../src/opfs-worker')
  receive?.({
    data: {
      requestId: `init`,
      type: `init`,
      databaseName: `locked.sqlite`,
      vfsName: `opfs`,
    },
  } as MessageEvent<BrowserOPFSWorkerRequest>)
  return response
}

describe(`OPFS worker initialization errors`, () => {
  it(`includes the VFS cause when SQLite reports a generic open failure`, async () => {
    mocks.vfs.lastError = new DOMException(
      `Access handle is locked [/locked.sqlite-wal]`,
      `NoModificationAllowedError`,
    )
    mocks.open.mockRejectedValue(new Error(`sqlite3_open_v2`))

    expect(await initialize()).toMatchObject({
      ok: false,
      code: `INTERNAL`,
      error:
        `sqlite3_open_v2: NoModificationAllowedError: ` +
        `Access handle is locked [/locked.sqlite-wal]`,
    })
  })

  it(`preserves the original error when the VFS has no cause`, async () => {
    mocks.open.mockRejectedValue(new Error(`original open failure`))

    expect(await initialize()).toMatchObject({
      ok: false,
      code: `INTERNAL`,
      error: `original open failure`,
    })
  })
})
