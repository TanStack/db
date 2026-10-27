import { fc } from '@fast-check/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

/**
 * # Does an OPFS worker classify and explain initialization failure?
 *
 * Opening may fail with an Error or TypeError while the VFS exposes a separate
 * Error or DOMException cause. The worker response must preserve the primary
 * message and, when present, the cause name and message in stable order.
 *
 * The browser can also refuse the OPFS storage root itself: in a private
 * window, or a browser without OPFS storage, `navigator.storage.getDirectory()`
 * rejects. That is a capability failure, which the README surfaces as
 * `PersistenceUnavailableError`, so the worker answers `PERSISTENCE_UNAVAILABLE`
 * with the browser's error name and message, and SQLite never opens.
 *
 * A tiny string-concatenation model supplies the expected response. Generated
 * error classes and messages drive the real worker module through mocked
 * wa-sqlite and OPFS boundaries. Exact response comparison catches a dropped,
 * reordered, or replaced cause, or a capability failure reported as internal,
 * without claiming native lock behavior.
 */

type OpenFailure = {
  failsAt: `open`
  primaryKind: `Error` | `TypeError`
  primaryMessage: string
  cause: null | {
    kind: `Error` | `NoModificationAllowedError`
    message: string
  }
}

type StorageRootFailure = {
  failsAt: `storage root`
  kind: `UnknownError` | `SecurityError` | `NotAllowedError`
  message: string
}

type DiagnosticInput = OpenFailure | StorageRootFailure

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
// Like the real VFS, creation acquires the OPFS storage root.
vi.mock('@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js', () => ({
  OPFSCoopSyncVFS: {
    create: async () => {
      await navigator.storage.getDirectory()
      return mocks.vfs
    },
  },
}))

function makePrimary(input: OpenFailure): Error {
  return input.primaryKind === `TypeError`
    ? new TypeError(input.primaryMessage)
    : new Error(input.primaryMessage)
}

function makeCause(input: OpenFailure): Error | null {
  if (!input.cause) return null
  return input.cause.kind === `NoModificationAllowedError`
    ? new DOMException(input.cause.message, input.cause.kind)
    : new Error(input.cause.message)
}

function referenceMessage(input: OpenFailure): string {
  const fields = [input.primaryMessage]
  if (input.cause) {
    fields.push(input.cause.kind, input.cause.message)
  }
  return fields.join(`: `)
}

// The expected response, and whether SQLite open is reached.
function referenceResponse(input: DiagnosticInput): {
  response: BrowserOPFSWorkerResponse
  opens: boolean
} {
  return input.failsAt === `storage root`
    ? {
        response: {
          type: `response`,
          requestId: `diagnostic-oracle`,
          ok: false,
          code: `PERSISTENCE_UNAVAILABLE`,
          // The protocol carries details; the opener adds the class's prefix.
          error: `OPFS storage is unavailable: ${input.kind}: ${input.message}`,
        },
        opens: false,
      }
    : {
        response: {
          type: `response`,
          requestId: `diagnostic-oracle`,
          ok: false,
          code: `INTERNAL`,
          error: referenceMessage(input),
        },
        opens: true,
      }
}

async function initialize(
  input: DiagnosticInput,
): Promise<BrowserOPFSWorkerResponse> {
  const primary = input.failsAt === `open` ? makePrimary(input) : null
  const cause = input.failsAt === `open` ? makeCause(input) : null
  let receive:
    ((event: MessageEvent<BrowserOPFSWorkerRequest>) => void) | undefined
  vi.resetModules()
  mocks.open.mockReset()
  mocks.open.mockRejectedValue(primary)
  mocks.vfs.lastError = cause
  vi.stubGlobal(`navigator`, {
    storage: {
      getDirectory: () =>
        input.failsAt === `storage root`
          ? Promise.reject(new DOMException(input.message, input.kind))
          : Promise.resolve({}),
    },
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
      wasmUrl: `https://example.test/wa-sqlite.wasm`,
      packageVersion: `source`,
    },
  } as MessageEvent<BrowserOPFSWorkerRequest>)

  const result = await response
  // Reach: SQLite open runs exactly when the model says it is reached.
  expect(mocks.open).toHaveBeenCalledTimes(
    referenceResponse(input).opens ? 1 : 0,
  )
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

const openFailure: fc.Arbitrary<DiagnosticInput> = fc.record({
  failsAt: fc.constant(`open` as const),
  primaryKind: fc.constantFrom<OpenFailure[`primaryKind`]>(
    `Error`,
    `TypeError`,
  ),
  primaryMessage: message,
  cause: fc.option(
    fc.record({
      kind: fc.constantFrom<NonNullable<OpenFailure[`cause`]>[`kind`]>(
        `Error`,
        `NoModificationAllowedError`,
      ),
      message,
    }),
    { nil: null },
  ),
})

const storageRootFailure: fc.Arbitrary<DiagnosticInput> = fc.record({
  failsAt: fc.constant(`storage root` as const),
  kind: fc.constantFrom<StorageRootFailure[`kind`]>(
    `UnknownError`,
    `SecurityError`,
    `NotAllowedError`,
  ),
  message,
})

const diagnosticInput = fc.oneof(openFailure, storageRootFailure)

const diagnosticProperty = `opfs-worker.diagnostics`
const diagnosticRuns = 40
// A path replay of this property runs only the random campaign, from its
// recorded history, once. A seed without a path reseeds the random campaign
// and keeps the fixed one.
const diagnosticExamples: Array<[DiagnosticInput]> = [
  // WebKit without OPFS storage rejects the root with this exact error.
  [
    {
      failsAt: `storage root`,
      kind: `UnknownError`,
      message: `The operation failed for an unknown transient reason (e.g. out of memory).`,
    },
  ],
  [{ failsAt: `storage root`, kind: `SecurityError`, message: `denied` }],
  [
    {
      failsAt: `open`,
      primaryKind: `Error`,
      primaryMessage: `original open failure`,
      cause: null,
    },
  ],
  [
    {
      failsAt: `open`,
      primaryKind: `TypeError`,
      primaryMessage: `typed open failure`,
      cause: null,
    },
  ],
  [
    {
      failsAt: `open`,
      primaryKind: `Error`,
      primaryMessage: `sqlite3_open_v2`,
      cause: { kind: `Error`, message: `plain VFS failure` },
    },
  ],
  [
    {
      failsAt: `open`,
      primaryKind: `TypeError`,
      primaryMessage: `typed open failure`,
      cause: { kind: `Error`, message: `plain VFS failure` },
    },
  ],
  [
    {
      failsAt: `open`,
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
      failsAt: `open`,
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
  expect(await initialize(input)).toEqual(referenceResponse(input).response)
}

/*
Law/source: the README Notes section promises that SQLite open failures include
the underlying VFS error name/message when available; without one, the primary
error is preserved. The worker protocol owns the INTERNAL classification. The
README surfaces OPFS capability failures as PersistenceUnavailableError, so a
rejected storage root answers PERSISTENCE_UNAVAILABLE before SQLite opens.
Domain: generated safe primary/cause messages, Error and TypeError primaries,
plain Error and NoModificationAllowedError causes, plus no cause; and a storage
root rejected with UnknownError, SecurityError, or NotAllowedError.
Reference/path/checkpoint: expected text is projected from immutable scalar
input before Error objects cross the production boundary. A field-list model is
compared to the complete response after the real init-message handler observes
a mocked open_v2 rejection; call reach is asserted.
Observed: exact response kind, request ID, status, error code, and text. Mocked
wasm/VFS objects do not prove native open or handle release, and this does not
cover the separate upstream partial-open race.
Grammar: the bounded message alphabet has lengths 1–12; the six open-failure
examples reconstruct every primary kind × absent/plain/DOMException cause
class, and two storage-root examples include WebKit's exact UnknownError. A
non-Error cause is outside this promise. Removing either class or the absent
case loses one of those fixed witnesses.
Challenge/replay: the present-cause examples reject a response that drops the
cause; the absent-cause examples reject an invented cause. Pinned examples run
separately so both generated campaigns share one property and budget, and a
reported shrink path selects its generated case directly. Verbose FastCheck
output retains original/reduced traces. Set
TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH, and
TANSTACK_DB_ORACLE_PROPERTY=opfs-worker.diagnostics for direct replay.
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER scales the generated campaign.
*/
describe(`OPFS worker diagnostics oracle`, () => {
  if (!oracleReplayRequested()) {
    it.each(diagnosticExamples)(
      `preserves the pinned open-failure diagnostic (%#)`,
      checkDiagnostic,
    )
  }

  it.skipIf(oracleReplayRequested())(
    `rejects a diagnostic that drops an exposed VFS cause`,
    async () => {
      const input = diagnosticExamples[6]![0] as OpenFailure
      const response = await initialize(input)
      const expected = referenceResponse(input).response

      expect(response).toEqual(expected)
      expect({ ...response, error: input.primaryMessage }).not.toEqual(expected)
    },
  )

  const checkDiagnostics = (options: { numRuns: number; seed?: number }) =>
    fc.assert(fc.asyncProperty(diagnosticInput, checkDiagnostic), {
      ...options,
      verbose: true,
    })
  oracleReplayTest(it)(
    `matches the independent diagnostic formatter (fixed campaign)`,
    () => checkDiagnostics({ seed: 1846, numRuns: oracleRuns(diagnosticRuns) }),
    15_000,
  )
  oracleReplayTest(it, diagnosticProperty)(
    `matches the independent diagnostic formatter (random campaign)`,
    () =>
      checkDiagnostics(
        oraclePropertyOptions(diagnosticRuns, diagnosticProperty),
      ),
    15_000,
  )
})
