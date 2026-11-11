import fc from 'fast-check'
import { vi } from 'vitest'
import { startOfflineExecutor } from '../src/OfflineExecutor'
import { IndexedDBAdapter } from '../src/storage/IndexedDBAdapter'
import { LocalStorageAdapter } from '../src/storage/LocalStorageAdapter'
import { WebLocksLeader } from '../src/coordination/WebLocksLeader'
import { BroadcastChannelLeader } from '../src/coordination/BroadcastChannelLeader'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property'
import { FakeStorageAdapter, gate, turn } from './harness'
import { captureUnhandledRejections } from './oracle-lifecycle'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  LeaderElection,
  OnlineDetector,
  StorageDiagnostic,
  StorageDiagnosticCode,
} from '../src/types'

/**
 * An executor uses supplied storage, or prefers available IndexedDB over
 * localStorage. Without either store it initializes in online-only mode and
 * reports storage failure. With storage, supplied coordination wins; otherwise
 * Web Locks precedes BroadcastChannel, then the single-tab leader fallback.
 * Storage availability and leadership are distinct: only a live leader enables
 * offline admission. Disposal during initialization closes that admission and
 * still lets waitForInit settle after its held dependency answers.
 *
 * Authority: the offline-transactions guide, "Storage and leadership"
 * and "React Native and Expo"; README storage/coordination configuration;
 * public StorageDiagnostic, OfflineConfig and waitForInit contracts. Existing
 * storage-failure contract tests establish diagnostic codes. The leadership
 * startup owner establishes preservation of an Error rejection by identity.
 * Required diagnostic fields exist even while initialization is pending; their
 * provisional values and all diagnostic wording remain implementation freedom.
 *
 * Controlled probe answers and controlled election collaborators supply the
 * environment premises. The real factory selects adapters and initializes the
 * real outbox/executor. Public adapter reads identify which store it selected.
 * This does not establish native browser durability or native election timing.
 */

type FailureKind = `none` | `security` | `quota` | `other`
type Backend = `custom` | `indexeddb` | `localstorage` | `none`
type Coordination = `custom` | `locks` | `broadcast` | `fallback`
type EnvironmentHistory = {
  customStorage: boolean
  indexeddb: boolean
  localstorage: boolean
  indexeddbFailure: FailureKind
  localstorageFailure: FailureKind
  customElection: boolean
  locks: boolean
  broadcast: boolean
  leader: boolean
  callbacks: boolean
  disposeAt: `none` | `storage` | `leadership`
  fault: `none` | `probe` | `leadership` | `replay`
  faultValue: `error` | `string`
  lateInitRead: boolean
}

const environmentFields = {
  customStorage: fc.boolean(),
  indexeddb: fc.boolean(),
  localstorage: fc.boolean(),
  indexeddbFailure: fc.constantFrom<FailureKind>(
    `none`,
    `security`,
    `quota`,
    `other`,
  ),
  localstorageFailure: fc.constantFrom<FailureKind>(
    `none`,
    `security`,
    `quota`,
    `other`,
  ),
  customElection: fc.boolean(),
  locks: fc.boolean(),
  broadcast: fc.boolean(),
  leader: fc.boolean(),
  callbacks: fc.boolean(),
  disposeAt: fc.constantFrom<EnvironmentHistory[`disposeAt`]>(
    `none`,
    `storage`,
    `leadership`,
  ),
  fault: fc.constantFrom<EnvironmentHistory[`fault`]>(
    `none`,
    `probe`,
    `leadership`,
    `replay`,
  ),
  faultValue: fc.constantFrom<EnvironmentHistory[`faultValue`]>(
    `error`,
    `string`,
  ),
  lateInitRead: fc.boolean(),
}

// The grammar excludes a leadership cut with no store, a probe fault when no
// probe runs, and a failed dependency after disposal. Each remaining axis can
// change a public diagnostic, initialization result, callback, or admission cut.
// Both available stores and each single-store/no-store marginal are generated.
function legalEnvironment(plan: EnvironmentHistory): EnvironmentHistory {
  const backend = storageChoice(plan)
  const coordination = coordinationChoice(plan)
  return {
    ...plan,
    disposeAt:
      plan.disposeAt === `leadership` && backend === `none`
        ? `none`
        : plan.disposeAt,
    fault:
      plan.disposeAt !== `none` ||
      (plan.fault === `probe` && plan.customStorage) ||
      ((plan.fault === `leadership` || plan.fault === `replay`) &&
        backend === `none`) ||
      (plan.fault === `leadership` && coordination === `fallback`) ||
      (plan.fault === `replay` && coordination !== `fallback` && !plan.leader)
        ? `none`
        : plan.fault,
  }
}
const environmentHistory = fc
  .record(environmentFields)
  .map(legalEnvironment, (plan) => plan as EnvironmentHistory)

// These preferences come from the public configuration contract. No production
// availability helper, error classifier, or initialization state is consulted.
function storageChoice(plan: EnvironmentHistory): Backend {
  return plan.customStorage
    ? `custom`
    : plan.indexeddb
      ? `indexeddb`
      : plan.localstorage
        ? `localstorage`
        : `none`
}
function coordinationChoice(plan: EnvironmentHistory): Coordination {
  return plan.customElection
    ? `custom`
    : plan.locks
      ? `locks`
      : plan.broadcast
        ? `broadcast`
        : `fallback`
}
function environmentModel(plan: EnvironmentHistory) {
  const backend = storageChoice(plan)
  const coordination = coordinationChoice(plan)
  const leader = coordination === `fallback` || plan.leader
  const unavailable = [plan.indexeddbFailure, plan.localstorageFailure]
  const codes: Array<StorageDiagnosticCode> =
    backend === `custom` || backend === `indexeddb`
      ? [`STORAGE_AVAILABLE`]
      : backend === `localstorage`
        ? [`INDEXEDDB_UNAVAILABLE`]
        : [
            ...(unavailable.includes(`security`)
              ? [`STORAGE_BLOCKED` as const]
              : []),
            ...(unavailable.includes(`quota`)
              ? [`QUOTA_EXCEEDED` as const]
              : []),
            ...(unavailable.every(
              (kind) => kind !== `security` && kind !== `quota`,
            )
              ? [`UNKNOWN_ERROR` as const]
              : []),
          ]
  // Mixed security/quota failures permit either applicable diagnosis. No exact
  // precedence or first-error preference is claimed for two distinct failures.
  return {
    backend,
    coordination,
    leader,
    codes,
    initialized: plan.fault === `none` ? `fulfilled` : `rejected`,
    // A rejected probe or leadership request never granted admission. Once
    // leadership was granted, replay failure has no separate availability law;
    // either enabled value remains permitted until disposal closes admission.
    enabled:
      plan.fault === `replay`
        ? undefined
        : plan.disposeAt === `none` &&
          plan.fault === `none` &&
          backend !== `none` &&
          leader,
    mode: backend === `none` ? `online-only` : `offline`,
  }
}

type InitResult = {
  state: `pending` | `fulfilled` | `rejected`
  error?: unknown
}
type DiagnosticView = {
  code: unknown
  mode: unknown
  message: unknown
  errorSource: `indexeddb` | `localstorage` | `none` | `other`
}
type EnvironmentCut = {
  initialized: InitResult[`state`]
  rejectionPreserved: boolean
  mode: unknown
  diagnostic: DiagnosticView
  enabled: boolean
  requested: Array<Coordination>
  reads: Array<Backend>
  leadership: Array<boolean>
  storageFailures: Array<DiagnosticView>
  disposeErrors: Array<string>
  unhandled: Array<string>
}

class EnvironmentDetector implements OnlineDetector {
  subscribe() {
    return () => {}
  }
  notifyOnline() {}
  isOnline() {
    return false
  }
  dispose() {}
}

// Bounded turns record absence as data instead of awaiting a promise that a
// mutant may strand. Task turns are scheduling cuts, not elapsed-time claims.
async function settleEnvironment(predicate: () => boolean) {
  for (let index = 0; index < 30 && !predicate(); index++) await turn()
  await turn()
}
function probeError(kind: FailureKind, source: string): Error | undefined {
  if (kind === `none`) return undefined
  const error = new Error(`${source} unavailable`)
  error.name =
    kind === `security`
      ? `SecurityError`
      : kind === `quota`
        ? `QuotaExceededError`
        : `UnknownError`
  return error
}

async function driveEnvironment(
  plan: EnvironmentHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const unhandled = captureUnhandledRejections()
  const storageGate = gate()
  const leadershipGate = gate()
  const requested: Array<Coordination> = []
  const reads: Array<Backend> = []
  const leadership: Array<boolean> = []
  const failures: Array<StorageDiagnostic> = []
  const disposeErrors: Array<string> = []
  const indexeddbError = probeError(plan.indexeddbFailure, `indexeddb`)
  const localstorageError = probeError(plan.localstorageFailure, `localstorage`)
  const injected =
    plan.faultValue === `error`
      ? new Error(`startup dependency failed`)
      : `startup dependency failed`
  const init: InitResult = { state: `pending` }
  const restores: Array<() => void> = [() => warn.mockRestore()]
  let executor: ReturnType<typeof startOfflineExecutor> | undefined
  const entered = { storage: false, leadership: false, failure: false }
  const viewDiagnostic = (
    diagnostic: StorageDiagnostic | undefined,
  ): DiagnosticView => ({
    code: diagnostic?.code,
    mode: diagnostic?.mode,
    message: diagnostic?.message,
    errorSource:
      diagnostic?.error === undefined
        ? `none`
        : diagnostic.error === indexeddbError
          ? `indexeddb`
          : diagnostic.error === localstorageError
            ? `localstorage`
            : `other`,
  })
  const snapshot = (): EnvironmentCut => ({
    initialized: init.state,
    rejectionPreserved: init.error === injected,
    mode: executor!.mode,
    diagnostic: viewDiagnostic(executor!.storageDiagnostic),
    enabled: executor!.isOfflineEnabled,
    requested: [...requested],
    reads: [...reads],
    leadership: [...leadership],
    storageFailures: failures.map(viewDiagnostic),
    disposeErrors: [...disposeErrors],
    unhandled: unhandled.rejections.map(String),
  })
  const dispose = () => {
    try {
      executor!.dispose()
    } catch (error) {
      disposeErrors.push(String(error))
    }
  }
  try {
    // The adapter objects remain real. Public storage methods are controlled
    // at the external adapter boundary so selection is observable through
    // peekOutbox and startup replay, without reading executor private fields.
    const adapters = {
      custom: new FakeStorageAdapter(),
      indexeddb: new FakeStorageAdapter(),
      localstorage: new FakeStorageAdapter(),
    }
    const keys = async (backend: Exclude<Backend, `none`>) => {
      reads.push(backend)
      if (plan.fault === `replay`) {
        entered.failure = true
        throw injected
      }
      return adapters[backend].keys()
    }
    const customKeys = adapters.custom.keys.bind(adapters.custom)
    restores.push(() => {
      adapters.custom.keys = customKeys
    })
    adapters.custom.keys = async () => {
      reads.push(`custom`)
      if (plan.fault === `replay`) {
        entered.failure = true
        throw injected
      }
      return customKeys()
    }
    for (const [Constructor, backend] of [
      [IndexedDBAdapter, `indexeddb`],
      [LocalStorageAdapter, `localstorage`],
    ] as const) {
      const store = adapters[backend]
      const spies = [
        vi
          .spyOn(Constructor.prototype, `keys`)
          .mockImplementation(() => keys(backend)),
        vi
          .spyOn(Constructor.prototype, `get`)
          .mockImplementation((key) => store.get(key)),
        vi
          .spyOn(Constructor.prototype, `set`)
          .mockImplementation((key, value) => store.set(key, value)),
        vi
          .spyOn(Constructor.prototype, `delete`)
          .mockImplementation((key) => store.delete(key)),
        vi
          .spyOn(Constructor.prototype, `clear`)
          .mockImplementation(() => store.clear()),
      ]
      restores.push(() => spies.forEach((spy) => spy.mockRestore()))
    }
    const idbProbe = vi
      .spyOn(IndexedDBAdapter, `probe`)
      .mockImplementation(async () => {
        entered.storage = true
        await storageGate.promise
        if (plan.fault === `probe`) {
          entered.failure = true
          throw injected
        }
        return { available: plan.indexeddb, error: indexeddbError }
      })
    const lsProbe = vi
      .spyOn(LocalStorageAdapter, `probe`)
      .mockImplementation(() => ({
        available: plan.localstorage,
        error: localstorageError,
      }))
    restores.push(
      () => idbProbe.mockRestore(),
      () => lsProbe.mockRestore(),
    )
    const request = async (choice: Coordination) => {
      entered.leadership = true
      requested.push(choice)
      await leadershipGate.promise
      if (plan.fault === `leadership`) {
        entered.failure = true
        throw injected
      }
      return plan.leader
    }
    const customElection: LeaderElection = {
      requestLeadership: () => request(`custom`),
      releaseLeadership: () => {},
      isLeader: () => plan.leader,
      onLeadershipChange: () => () => {},
    }
    const supportSpies = [
      vi.spyOn(WebLocksLeader, `isSupported`).mockReturnValue(plan.locks),
      vi
        .spyOn(BroadcastChannelLeader, `isSupported`)
        .mockReturnValue(plan.broadcast),
    ]
    restores.push(() => supportSpies.forEach((spy) => spy.mockRestore()))
    for (const [Constructor, choice] of [
      [WebLocksLeader, `locks`],
      [BroadcastChannelLeader, `broadcast`],
    ] as const) {
      const spies = [
        vi
          .spyOn(Constructor.prototype, `requestLeadership`)
          .mockImplementation(() => request(choice)),
        vi
          .spyOn(Constructor.prototype, `releaseLeadership`)
          .mockImplementation(() => {}),
      ]
      restores.push(() => spies.forEach((spy) => spy.mockRestore()))
    }
    // BroadcastChannel construction is a transport premise, not a native-host
    // witness. Its timers/election methods are controlled above.
    const channelDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      `BroadcastChannel`,
    )
    class ControlledChannel {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      close() {}
    }
    Object.defineProperty(globalThis, `BroadcastChannel`, {
      configurable: true,
      writable: true,
      value: ControlledChannel,
    })
    restores.push(() => {
      if (channelDescriptor)
        Object.defineProperty(globalThis, `BroadcastChannel`, channelDescriptor)
      else Reflect.deleteProperty(globalThis, `BroadcastChannel`)
    })
    executor = startOfflineExecutor({
      collections: {},
      mutationFns: {},
      ...(plan.customStorage ? { storage: adapters.custom } : {}),
      ...(plan.customElection ? { leaderElection: customElection } : {}),
      onlineDetector: new EnvironmentDetector(),
      ...(plan.callbacks
        ? {
            onLeadershipChange: (isLeader: boolean) =>
              leadership.push(isLeader),
            onStorageFailure: (diagnostic: StorageDiagnostic) =>
              failures.push(diagnostic),
          }
        : {}),
    })
    const readInit = () => {
      void executor!.waitForInit().then(
        () => {
          init.state = `fulfilled`
        },
        (error: unknown) => {
          init.state = `rejected`
          init.error = error
        },
      )
    }
    if (!plan.lateInitRead) readInit()
    observe(`constructed`, snapshot())
    if (plan.disposeAt === `storage`) {
      if (init.state === `pending`) observe(`reach`, `disposal during storage`)
      dispose()
    }
    storageGate.resolve()
    if (plan.disposeAt === `leadership`) {
      await settleEnvironment(
        () => entered.leadership || init.state !== `pending`,
      )
      // Fallback leadership has an immediate answer, so the turn after storage
      // is its admission cut. Custom/default requests have a held answer.
      if (entered.leadership) observe(`reach`, `disposal during leadership`)
      dispose()
    }
    leadershipGate.resolve()
    if (plan.lateInitRead) {
      // Initialization starts in the constructor. A caller may read its result
      // later without letting an earlier failure escape as an unhandled
      // rejection. Authority: OfflineExecutor.test.ts's unread-init contract.
      for (let index = 0; index < 5; index++) await turn()
      observe(`unread initialization`, snapshot())
      if (entered.failure)
        observe(`reach`, `startup failure without init reader`)
      readInit()
    }
    await settleEnvironment(() => init.state !== `pending`)
    if (
      plan.disposeAt === `none` &&
      plan.fault === `none` &&
      init.state === `fulfilled`
    ) {
      let readSettled = false
      void executor.peekOutbox().then(
        () => {
          readSettled = true
        },
        () => {
          readSettled = true
        },
      )
      await settleEnvironment(() => readSettled)
    }
    observe(`initialized`, snapshot())
    if (entered.storage) observe(`reach`, `built-in storage probe`)
    if (init.state === `rejected`) {
      observe(`reach`, `initialization rejection`)
      if (!executor.isOfflineEnabled && plan.fault === `probe`)
        observe(`reach`, `probe failure without leadership`)
      if (!executor.isOfflineEnabled && plan.fault === `leadership`)
        observe(`reach`, `leadership failure without leadership`)
    }
    if (init.state === `fulfilled` && plan.disposeAt === `none`) {
      const backend = storageChoice(plan)
      if (backend === `none` && executor.mode === `online-only`)
        observe(`reach`, `storage none`)
      else if (reads.includes(backend)) observe(`reach`, `storage ${backend}`)
      if (requested.includes(coordinationChoice(plan)))
        observe(`reach`, `coordination ${coordinationChoice(plan)}`)
      if (coordinationChoice(plan) === `fallback` && executor.isOfflineEnabled)
        observe(`reach`, `coordination fallback`)
      if (plan.callbacks && leadership.length)
        observe(`reach`, `initial leadership callback`)
      if (plan.callbacks && failures.length)
        observe(`reach`, `storage failure callback`)
      if (backend !== `none` && !executor.isOfflineEnabled)
        observe(`reach`, `follower`)
      const diagnostic = viewDiagnostic(executor.storageDiagnostic)
      if (backend === `none`) {
        if (
          (diagnostic.errorSource === `indexeddb` ||
            diagnostic.errorSource === `localstorage`) &&
          (diagnostic.code === `STORAGE_BLOCKED` ||
            diagnostic.code === `QUOTA_EXCEEDED`)
        )
          observe(
            `reach`,
            `storage ${diagnostic.code === `STORAGE_BLOCKED` ? `blocked` : `quota`} ${diagnostic.errorSource}`,
          )
        if (
          diagnostic.code === `UNKNOWN_ERROR` &&
          diagnostic.errorSource === `indexeddb`
        )
          observe(`reach`, `storage unknown`)
        if (
          diagnostic.code === `UNKNOWN_ERROR` &&
          diagnostic.errorSource === `none`
        )
          observe(`reach`, `storage unavailable no reason`)
        if (!plan.callbacks && failures.length === 0)
          observe(`reach`, `online-only without callback`)
      } else {
        if (
          backend === `localstorage` &&
          diagnostic.errorSource === `indexeddb`
        )
          observe(`reach`, `localstorage fallback error`)
        if (!plan.callbacks && leadership.length === 0)
          observe(`reach`, `offline without callback`)
      }
    }
    dispose()
    observe(`disposed`, snapshot())
  } finally {
    storageGate.resolve()
    leadershipGate.resolve()
    if (executor) dispose()
    await turn()
    for (const restore of restores.reverse()) restore()
    unhandled.cleanup()
  }
}

function checkEnvironment(
  plan: EnvironmentHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof environmentModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as EnvironmentCut
    const diagnostic = cut.diagnostic
    if (
      typeof diagnostic.message !== `string` ||
      ![`offline`, `online-only`].includes(String(diagnostic.mode)) ||
      ![
        `STORAGE_AVAILABLE`,
        `INDEXEDDB_UNAVAILABLE`,
        `LOCALSTORAGE_UNAVAILABLE`,
        `STORAGE_BLOCKED`,
        `QUOTA_EXCEEDED`,
        `UNKNOWN_ERROR`,
      ].includes(String(diagnostic.code))
    )
      return violation(
        checkpoint,
        `required diagnostic fields are absent or invalid`,
        `diagnostic shape`,
      )
    if (checkpoint === `constructed`) continue
    if (checkpoint === `unread initialization`) {
      const mismatch = differs(checkpoint, `unhandled`, cut.unhandled, [])
      if (mismatch) return mismatch
      continue
    }
    const common =
      differs(
        checkpoint,
        `initialization completion`,
        cut.initialized,
        model.initialized,
      ) ??
      differs(checkpoint, `disposal resources`, cut.disposeErrors, []) ??
      differs(checkpoint, `unhandled`, cut.unhandled, [])
    if (common) return common
    const enabled = checkpoint === `disposed` ? false : model.enabled
    if (enabled !== undefined) {
      const admission = differs(
        checkpoint,
        `leadership admission`,
        cut.enabled,
        enabled,
      )
      if (admission) return admission
    }
    if (plan.fault !== `none`) {
      // Rejection with an Error preserves that Error. The public startup
      // contract does not prescribe normalization of a non-Error rejection.
      const mismatch =
        plan.faultValue === `error`
          ? differs(
              checkpoint,
              `initialization rejection`,
              cut.rejectionPreserved,
              true,
            )
          : undefined
      if (mismatch) return mismatch
      continue
    }
    // Disposal before the storage answer leaves its provisional diagnostic.
    // Only required shape is owed there; no final storage result is promised.
    if (plan.disposeAt === `storage`) continue
    if (!model.codes.includes(diagnostic.code as StorageDiagnosticCode))
      return violation(
        checkpoint,
        `diagnostic does not describe the available storage`,
        `storage diagnostic`,
      )
    const mode =
      differs(checkpoint, `storage mode`, cut.mode, model.mode) ??
      differs(checkpoint, `storage mode`, diagnostic.mode, model.mode)
    if (mode) return mode
    const expectedErrors =
      model.backend === `localstorage`
        ? plan.indexeddbFailure === `none`
          ? [`none`]
          : [`indexeddb`]
        : model.backend === `none`
          ? [
              ...(plan.indexeddbFailure !== `none` ? [`indexeddb`] : []),
              ...(plan.localstorageFailure !== `none` ? [`localstorage`] : []),
              ...(plan.indexeddbFailure === `none` &&
              plan.localstorageFailure === `none`
                ? [`none`]
                : []),
            ]
          : [`none`]
    if (!expectedErrors.includes(diagnostic.errorSource))
      return violation(
        checkpoint,
        `diagnostic lost the storage failure identity`,
        `diagnostic error provenance`,
      )
    if (plan.disposeAt === `none`) {
      const expectedRequests =
        model.backend === `none` || model.coordination === `fallback`
          ? []
          : [model.coordination]
      const requestMismatch = differs(
        checkpoint,
        `coordination preference`,
        cut.requested,
        expectedRequests,
      )
      if (requestMismatch) return requestMismatch
      if (model.backend !== `none` && !cut.reads.includes(model.backend))
        return violation(
          checkpoint,
          `the selected adapter did not receive the public outbox read`,
          `storage preference`,
        )
      if (cut.reads.some((backend) => backend !== model.backend))
        return violation(
          checkpoint,
          `outbox reads reached a different adapter`,
          `storage preference`,
        )
      const expectedLeadership =
        plan.callbacks && model.backend !== `none` ? [model.leader] : []
      const callbacks =
        differs(
          checkpoint,
          `initial leadership notification`,
          cut.leadership,
          expectedLeadership,
        ) ??
        differs(
          checkpoint,
          `storage failure notification`,
          cut.storageFailures.length,
          plan.callbacks && model.backend === `none` ? 1 : 0,
        )
      if (callbacks) return callbacks
      for (const failure of cut.storageFailures) {
        const mismatch = differs(
          checkpoint,
          `storage failure notification`,
          failure,
          diagnostic,
        )
        if (mismatch) return mismatch
      }
    }
  }
  return pass
}

declareOracle({
  grammar: [environmentHistory],
  model: [environmentModel],
  check: [checkEnvironment],
})
const environmentStates = [
  `storage custom`,
  `storage indexeddb`,
  `storage localstorage`,
  `storage none`,
  `coordination custom`,
  `coordination locks`,
  `coordination broadcast`,
  `coordination fallback`,
  `built-in storage probe`,
  `disposal during storage`,
  `disposal during leadership`,
  `initialization rejection`,
  `initial leadership callback`,
  `storage failure callback`,
  `follower`,
  `storage blocked indexeddb`,
  `storage blocked localstorage`,
  `storage quota indexeddb`,
  `storage quota localstorage`,
  `storage unknown`,
  `storage unavailable no reason`,
  `localstorage fallback error`,
  `online-only without callback`,
  `offline without callback`,
  `probe failure without leadership`,
  `leadership failure without leadership`,
  `startup failure without init reader`,
]
function constructEnvironment(
  state: string,
  plan: EnvironmentHistory,
): EnvironmentHistory {
  const base: EnvironmentHistory = {
    ...plan,
    customStorage: true,
    customElection: true,
    indexeddb: false,
    localstorage: false,
    locks: false,
    broadcast: false,
    leader: true,
    callbacks: true,
    disposeAt: `none`,
    fault: `none`,
    indexeddbFailure: `none`,
    localstorageFailure: `none`,
  }
  if (state === `storage indexeddb` || state === `built-in storage probe`)
    return { ...base, customStorage: false, indexeddb: true }
  if (state === `storage localstorage`)
    return { ...base, customStorage: false, localstorage: true }
  if (state === `localstorage fallback error`)
    return {
      ...base,
      customStorage: false,
      localstorage: true,
      indexeddbFailure: `other`,
    }
  if (state === `storage none` || state === `storage failure callback`)
    return { ...base, customStorage: false }
  if (state === `coordination locks`)
    return { ...base, customElection: false, locks: true, broadcast: true }
  if (state === `coordination broadcast`)
    return { ...base, customElection: false, broadcast: true }
  if (state === `coordination fallback`)
    return { ...base, customElection: false }
  if (state === `disposal during storage`)
    return { ...base, customStorage: false, disposeAt: `storage` }
  if (state === `disposal during leadership`)
    return { ...base, disposeAt: `leadership` }
  if (state === `initialization rejection`)
    return { ...base, fault: `leadership` }
  if (state === `probe failure without leadership`)
    return { ...base, customStorage: false, fault: `probe` }
  if (state === `leadership failure without leadership`)
    return { ...base, fault: `leadership` }
  if (state === `startup failure without init reader`)
    return { ...base, fault: `replay`, lateInitRead: true }
  if (state === `follower`) return { ...base, leader: false }
  if (state === `offline without callback`) return { ...base, callbacks: false }
  if (state === `online-only without callback`)
    return { ...base, customStorage: false, callbacks: false }
  if (state === `storage unavailable no reason`)
    return { ...base, customStorage: false }
  if (state === `storage unknown`)
    return { ...base, customStorage: false, indexeddbFailure: `other` }
  if (
    state.startsWith(`storage blocked `) ||
    state.startsWith(`storage quota `)
  ) {
    const failure = state.startsWith(`storage blocked `) ? `security` : `quota`
    return {
      ...base,
      customStorage: false,
      indexeddbFailure: state.endsWith(`indexeddb`) ? failure : `none`,
      localstorageFailure: state.endsWith(`localstorage`) ? failure : `none`,
    }
  }
  return base
}
oracleProperty<EnvironmentHistory, ReturnType<typeof environmentModel>>({
  id: `offline.executor-environment`,
  law: {
    statement: `Initialization selects configured or preferred available storage and coordination, reports public diagnostics and callbacks, gates offline admission on leadership, and settles across disposal or dependency failure.`,
    authority: `Offline transactions guide Storage and leadership/React Native and Expo; README storage configuration; public StorageDiagnostic and waitForInit contracts; established storage-failure and unread-init tests.`,
    limits: `Controlled adapter probes and election collaborators; no native browser durability/election claim, no exact diagnostic wording, no mixed security/quota diagnostic precedence, no startup non-Error normalization promise or failed-replay availability law.`,
  },
  histories: {
    arbitrary: environmentHistory,
    runs: 100,
    fixedSeeds: [20261110],
    states: environmentStates,
    constructed: environmentStates.map((state) => ({
      name: state,
      enters: [state],
      build: (generated) => constructEnvironment(state, generated),
    })),
  },
  model: environmentModel,
  driver: driveEnvironment,
  check: checkEnvironment,
  calibrations: [
    {
      name: `initialization silently leaves its caller pending`,
      law: `initialization completion`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `initialized`
            ? {
                ...entry,
                value: {
                  ...(entry.value as EnvironmentCut),
                  initialized: `pending`,
                },
              }
            : entry,
        ),
    },
    {
      name: `provisional diagnostics omit their public message`,
      law: `diagnostic shape`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `constructed`
            ? {
                ...entry,
                value: {
                  ...(entry.value as EnvironmentCut),
                  diagnostic: {
                    ...(entry.value as EnvironmentCut).diagnostic,
                    message: undefined,
                  },
                },
              }
            : entry,
        ),
    },
    {
      name: `leadership becomes enabled after disposal`,
      law: `leadership admission`,
      corrupt: (trace, plan) =>
        plan.fault !== `none`
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `disposed`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as EnvironmentCut),
                      enabled: true,
                    },
                  }
                : entry,
            ),
    },
  ],
})
