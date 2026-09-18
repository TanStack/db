import { fc, test as fcTest } from '@fast-check/vitest'
import { afterEach, describe, expect, vi } from 'vitest'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

type DiagnosticInput = {
  primaryKind: `Error` | `TypeError`
  primaryMessage: string
  cause: null | {
    kind: `Error` | `NoModificationAllowedError`
    message: string
  }
}

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

function makePrimary(input: DiagnosticInput): Error {
  return input.primaryKind === `TypeError`
    ? new TypeError(input.primaryMessage)
    : new Error(input.primaryMessage)
}

function makeCause(input: DiagnosticInput): Error | null {
  if (!input.cause) return null
  return input.cause.kind === `NoModificationAllowedError`
    ? new DOMException(input.cause.message, input.cause.kind)
    : new Error(input.cause.message)
}

function referenceMessage(input: DiagnosticInput): string {
  const fields = [input.primaryMessage]
  if (input.cause) {
    fields.push(input.cause.kind, input.cause.message)
  }
  return fields.join(`: `)
}

async function initialize(
  primary: Error,
  cause: Error | null,
): Promise<BrowserOPFSWorkerResponse> {
  let receive:
    | ((event: MessageEvent<BrowserOPFSWorkerRequest>) => void)
    | undefined
  vi.resetModules()
  mocks.open.mockReset()
  mocks.open.mockRejectedValue(primary)
  mocks.vfs.lastError = cause
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
      requestId: `diagnostic-oracle`,
      type: `init`,
      databaseName: `locked.sqlite`,
      vfsName: `opfs`,
    },
  } as MessageEvent<BrowserOPFSWorkerRequest>)

  const result = await response
  expect(mocks.open).toHaveBeenCalledOnce()
  return result
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.resetModules()
  mocks.vfs.lastError = null
})

const message = fc
  .array(fc.constantFrom(...`abcXYZ019 _/-.[]:`), {
    minLength: 1,
    maxLength: 12,
  })
  .map((characters) => characters.join(``))

const diagnosticInput = fc.record({
  primaryKind: fc.constantFrom<DiagnosticInput[`primaryKind`]>(
    `Error`,
    `TypeError`,
  ),
  primaryMessage: message,
  cause: fc.option(
    fc.record({
      kind: fc.constantFrom<NonNullable<DiagnosticInput[`cause`]>[`kind`]>(
        `Error`,
        `NoModificationAllowedError`,
      ),
      message,
    }),
    { nil: null },
  ),
})

const diagnosticSeed = Number(
  process.env.TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_SEED ?? 1846,
)
const diagnosticRuns = Number(
  process.env.TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_RUNS ?? 40,
)
const diagnosticPath = process.env.TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_PATH

const diagnosticExamples: Array<[DiagnosticInput]> = [
  [
    {
      primaryKind: `Error`,
      primaryMessage: `original open failure`,
      cause: null,
    },
  ],
  [
    {
      primaryKind: `TypeError`,
      primaryMessage: `typed open failure`,
      cause: null,
    },
  ],
  [
    {
      primaryKind: `Error`,
      primaryMessage: `sqlite3_open_v2`,
      cause: { kind: `Error`, message: `plain VFS failure` },
    },
  ],
  [
    {
      primaryKind: `TypeError`,
      primaryMessage: `typed open failure`,
      cause: { kind: `Error`, message: `plain VFS failure` },
    },
  ],
  [
    {
      primaryKind: `Error`,
      primaryMessage: `sqlite3_open_v2`,
      cause: {
        kind: `NoModificationAllowedError`,
        message: `Access handle is locked [/locked.sqlite-wal]`,
      },
    },
  ],
  [
    {
      primaryKind: `TypeError`,
      primaryMessage: `typed open failure`,
      cause: {
        kind: `NoModificationAllowedError`,
        message: `access handle locked`,
      },
    },
  ],
]

/*
Law/source: the README Notes section promises that SQLite open failures include
the underlying VFS error name/message when available; without one, the primary
error is preserved. The worker protocol owns the INTERNAL classification.
Domain: generated safe primary/cause messages, Error and TypeError primaries,
plain Error and NoModificationAllowedError causes, plus no cause.
Reference/path/checkpoint: expected text is projected from immutable scalar
input before Error objects cross the production boundary. A field-list model is
compared to the complete response after the real init-message handler observes
a mocked open_v2 rejection; call reach is asserted.
Observed: exact response kind, request ID, status, error code, and text. Mocked
wasm/VFS objects do not prove native open or handle release, and this does not
cover the separate upstream partial-open race.
Challenge/replay: six fixed examples exhaust primary kind × cause class and
retain the original bracketed WAL-path diagnostic. Verbose FastCheck output
retains original/reduced traces. Replay with TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_*
and this file's package-local Vitest command.
*/
describe(`OPFS worker diagnostics oracle`, () => {
  fcTest.prop([diagnosticInput], {
    seed: diagnosticSeed,
    numRuns: diagnosticRuns,
    ...(diagnosticPath ? { path: diagnosticPath } : {}),
    examples: diagnosticExamples,
    verbose: true,
  })(
    `matches the independent diagnostic formatter`,
    async (input) => {
      const expectedMessage = referenceMessage(input)
      const primary = makePrimary(input)
      const cause = makeCause(input)

      expect(await initialize(primary, cause)).toEqual({
        type: `response`,
        requestId: `diagnostic-oracle`,
        ok: false,
        code: `INTERNAL`,
        error: expectedMessage,
      })
    },
    15_000,
  )
})
