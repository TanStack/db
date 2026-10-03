import { fc } from '@fast-check/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

/**
 * # Does an OPFS worker retain the useful cause of initialization failure?
 *
 * Opening may fail with an Error or TypeError while the VFS exposes a separate
 * Error or DOMException cause. The worker response must preserve the primary
 * message and, when present, the cause name and message in stable order.
 *
 * A tiny string-concatenation model supplies the expected diagnostic. Generated
 * error classes and messages drive the real worker module through mocked
 * wa-sqlite and OPFS boundaries. Exact response comparison catches a dropped,
 * reordered, or replaced cause without claiming native lock behavior.
 */

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
    ((event: MessageEvent<BrowserOPFSWorkerRequest>) => void) | undefined
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

const replaySeed = process.env.TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_SEED
const diagnosticSeed = Number(replaySeed ?? 1846)
const diagnosticRuns = Number(
  process.env.TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_RUNS ?? 40,
)
const diagnosticPath = process.env.TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_PATH
const replayRequested = replaySeed !== undefined || diagnosticPath !== undefined
const campaigns = replayRequested
  ? [{ name: `replay`, seed: diagnosticSeed }]
  : [
      { name: `fixed`, seed: diagnosticSeed },
      { name: `random`, seed: undefined },
    ]

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

async function checkDiagnostic(input: DiagnosticInput): Promise<void> {
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
}

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
Grammar: the bounded message alphabet has lengths 1–12; the six fixed examples
reconstruct every primary kind × absent/plain/DOMException cause class. A
non-Error cause is outside this promise. Removing either class or the absent
case loses one of those fixed witnesses.
Challenge/replay: the present-cause examples reject a response that drops the
cause; the absent-cause examples reject an invented cause. Pinned examples run
separately so both generated campaigns share one property and budget, and a
reported shrink path selects its generated case directly. Verbose FastCheck
output retains original/reduced traces. Set
TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_SEED and
TANSTACK_DB_OPFS_DIAGNOSTIC_ORACLE_PATH for direct replay.
*/
describe(`OPFS worker diagnostics oracle`, () => {
  if (!replayRequested) {
    it.each(diagnosticExamples)(
      `preserves the pinned open-failure diagnostic (%#)`,
      checkDiagnostic,
    )
  }

  it.skipIf(replayRequested)(
    `rejects a diagnostic that drops an exposed VFS cause`,
    async () => {
      const input = diagnosticExamples[4]![0]
      const response = await initialize(makePrimary(input), makeCause(input))
      const expected = {
        type: `response`,
        requestId: `diagnostic-oracle`,
        ok: false,
        code: `INTERNAL`,
        error: referenceMessage(input),
      }

      expect(response).toEqual(expected)
      expect({ ...response, error: input.primaryMessage }).not.toEqual(expected)
    },
  )

  it.each(campaigns)(
    `matches the independent diagnostic formatter ($name campaign)`,
    async ({ seed }) => {
      await fc.assert(fc.asyncProperty(diagnosticInput, checkDiagnostic), {
        ...(seed === undefined ? {} : { seed }),
        numRuns: diagnosticRuns,
        ...(diagnosticPath ? { path: diagnosticPath } : {}),
        verbose: true,
      })
    },
    15_000,
  )
})
