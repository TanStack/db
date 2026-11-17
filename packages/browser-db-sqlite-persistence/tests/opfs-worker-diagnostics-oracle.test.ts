import { fc } from '@fast-check/vitest'
import { afterEach, vi } from 'vitest'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
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
): Promise<{ response: BrowserOPFSWorkerResponse; opens: number }> {
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
  return { response: result, opens: mocks.open.mock.calls.length }
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
cause; the absent-cause examples reject an invented cause. Fixed histories run
separately so both generated campaigns share one property and budget, and a
reported shrink path selects its generated case directly. Verbose FastCheck
output retains original/reduced traces. Set
Copy the complete printed Replay: coordinates, including TANSTACK_DB_ORACLE_UNIT,
TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH, and
TANSTACK_DB_ORACLE_PROPERTY=opfs-worker.diagnostics for direct replay.
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER scales the generated campaign.
*/
// The formatter and admission relation keep the same independent judgment;
// native registration supplies fixed/random scheduling and direct replay.
function checkNative(
  _input: DiagnosticInput,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof referenceResponse>,
): Verdict {
  return (
    differs(
      `worker init response`,
      `diagnostic response and open reach`,
      trace.find((entry) => entry.checkpoint === `worker init response`)?.value,
      { response: expected.response, opens: expected.opens ? 1 : 0 },
    ) ?? pass
  )
}

oracleProperty({
  id: diagnosticProperty,
  law: {
    statement: `Worker initialization preserves the primary diagnostic and exposed VFS cause; storage-root capability failures report unavailability before SQLite opens.`,
    authority: `README Notes and the worker protocol's INTERNAL and PERSISTENCE_UNAVAILABLE classifications.`,
    limits: `Mocked wa-sqlite and OPFS boundaries; no native lock or handle-release claim.`,
  },
  owns: [`src/opfs-worker.ts`],
  histories: {
    arbitrary: diagnosticInput,
    runs: diagnosticRuns,
    fixedSeeds: [1846],
  },
  model: referenceResponse,
  driver: async (input, observe) => {
    observe(`worker init response`, await initialize(input))
  },
  check: checkNative,
  timeout: 15_000,
})

// These retained real-browser messages exceed the generated message alphabet's
// length bound, so run them as the same finite judgment, without widening it.
oracleProperty({
  id: `opfs-worker.diagnostics-fixed`,
  law: {
    statement: `The retained initialization failures preserve exact diagnostic fields and SQLite-open admission.`,
    authority: `README Notes and worker response protocol.`,
    limits: `The eight retained mocked initialization inputs, including WebKit's long UnknownError message.`,
  },
  owns: [`src/opfs-worker.ts`],
  histories: diagnosticExamples.map(([history]) => history),
  label: (_history) =>
    String(diagnosticExamples.findIndex(([history]) => history === _history)),
  model: referenceResponse,
  driver: async (input, observe) => {
    observe(`worker init response`, await initialize(input))
  },
  check: checkNative,
  // A present-cause example rejects a response that drops the cause: the
  // check must reject the retained example's real response with its error
  // replaced by the primary message alone. The framework runs it only where
  // the clean response and open reach match the model.
  calibrations: [
    {
      name: `rejects a diagnostic that drops an exposed VFS cause`,
      law: `diagnostic response and open reach`,
      corrupt: (trace, input) => {
        if (input !== diagnosticExamples[6]![0]) return undefined
        return trace.map((entry) => {
          if (entry.checkpoint !== `worker init response`) return entry
          const { response, opens } = entry.value as Awaited<
            ReturnType<typeof initialize>
          >
          return {
            ...entry,
            value: {
              response: {
                ...response,
                error: (input as OpenFailure).primaryMessage,
              },
              opens,
            },
          }
        })
      },
    },
  ],
  timeout: 15_000,
})
