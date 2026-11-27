/**
 * # Does a follower's write survive with `followerWrites: 'durable'`?
 *
 * Law and source: issue #2464 asks that a write from a follower tab not depend
 * on which tab leads. With `followerWrites: 'durable'`, a follower saves its
 * write to the shared outbox before the write can be lost, the current or next
 * leader sends it, and the writing tab's transaction settles with its outcome.
 * The default, `'online'`, keeps the documented follower path with no outbox
 * entry and no channel.
 *
 * Model: in durable mode, every write made from an initialized tab is delivered
 * once after some tab leads while online, whether or not its tab is still open.
 * It stays pending until then, and the leader shows it optimistically. A write
 * the server rejects permanently fails in its open tab with the server's error,
 * and every other write completes. Only the leader sends a durable write. When
 * a settlement message is lost, the outcome the leader recorded settles the
 * waiter at the next leader's outbox check, with the server's error for a
 * rejected write. A leader that cannot read a saved write, or whose replay
 * failed, tries again when connectivity changes. Stale and duplicate channel messages change nothing.
 * A write made before its tab initializes, and in online mode a follower's
 * write, uses the online path: the writing tab sends it, and offline it fails
 * and is never sent.
 *
 * History grammar: a mode and up to twelve actions over three tabs: write, a
 * write the server rejects, a write whose save is held or fails while a leader
 * message arrives, close a tab, reopen a tab, reopen a tab and write before it
 * initializes, go online or offline, lose the next settlement, deliver a stale
 * or duplicate message, fail the leader's admission read of a follower's saved
 * write, fail an outbox check's storage read, return a leader's admission read
 * only after a duplicate message sent and removed its write, fail the removal
 * of a sent follower write, announce a saved row the leader cannot decode,
 * return an admission read after leadership moved away and back while another
 * leader sent its write, and have the next leader's beforeRetry exclude a
 * follower's write while its settlement is lost. Further actions observe a
 * follower's rejected write from the leader, clear or remove unsent and
 * still-saving writes, stall an outbox load across a change of leadership,
 * fail a leader's start after setup, remove a write while its server call
 * runs, from any tab, resume an exclusion cleanup after its leadership ended,
 * replace a disposed writer's executor over the same collection, and, in the
 * default mode, let another
 * leader reject a former leader's saved write. Others fail a new leader's
 * replay and then reconnect, let a replay outlive its term, remove a running
 * write twice, record a rejection after its writer listed the outcome
 * records, store an unreadable outcome record or a decision with no error,
 * and fail a removed running write's call with a retryable error. The rest
 * deliver an added message while an unsent write's removal is decided, fail
 * the error record of a removed running write before its leader stops
 * leading, change connectivity during an outbox check that then fails, fail
 * a removal's read of a sent row's phase, and store a readable decision
 * beside an unreadable one.
 *
 * Production driver: real executors over one shared storage adapter, with a
 * controlled leader election, online detector and BroadcastChannel.
 *
 * Refinement check: after every action, pending writes stay pending and shown
 * by the leader once it read them, open channels match open tabs, and warnings
 * match the injected failures. After the history ends online with a leader,
 * each deliverable write reached the server exactly once from the tab the
 * model names, the outbox is empty, and each open tab's transaction has the
 * model's outcome and error. A lost settlement is recovered for the same write,
 * by the writer itself if it became leader, or else after one handover.
 *
 * A failed row removal after a successful send is not the write's outcome:
 * its writer waits, and the next leader finishes the removal. A row the leader
 * cannot decode is reported, not dropped, and a follower's failed outbox check
 * runs again when connectivity changes.
 *
 * Known omissions: a reloaded follower does not show another tab's pending
 * writes optimistically; rejection records of writers that never return are
 * pruned after seven days, which moves the clock and is checked in
 * outcome-retention.test.ts instead; and no real browser contexts.
 */
import fc from 'fast-check'
import { expect, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { NonRetriableError } from '../src/types'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import type {
  LeaderElection,
  OfflineMutationFnParams,
  OnlineDetector,
  StorageAdapter,
} from '../src/types'

const property = `offline.durable-follower-writes`
const TABS = 3
const MAX_ACTIONS = 12
const CHANNEL = `tanstack-offline-outbox:test-items`

const reachStates = [
  // A follower's write reached the server through the leader.
  `follower-write-delivered`,
  // A follower wrote offline and closed before the write was sent.
  `write-outlived-its-tab`,
  // The leader closed while holding a follower's unsent write.
  `leader-closed-with-follower-write`,
  // The server rejected a follower's write and its tab saw the failure.
  `follower-write-rejected`,
  // A lost settlement message was recovered by the next leader.
  `lost-settlement-recovered`,
  // A tab that stayed a follower recovered a lost settlement.
  `lost-settlement-recovered-by-follower`,
  // A follower's write used the default online path while offline.
  `online-mode-follower-write-failed`,
  // A message named a write that is no longer in the outbox.
  `stale-message-ignored`,
  // A second message named a write that is still queued.
  `duplicate-message-ignored`,
  // An admission's storage read failed.
  `admission-read-failed`,
  // An outbox check's storage read failed.
  `outbox-check-read-failed`,
  // A leader message arrived while a write was still being saved.
  `leader-message-during-save`,
  // A follower's save failed after a leader message arrived.
  `follower-save-failed`,
  // A leader's write completed in the default mode.
  `online-mode-leader-write-delivered`,
  // A write made before its tab initialized used the online path.
  `pre-initialization-write`,
  // A lost settlement of a rejected write still failed with its error.
  `lost-rejection-recovered`,
  // A saved write the leader could not read was sent after connectivity changed.
  `admission-retried`,
  // An admission read returned after its write was sent and removed.
  `stale-admission-ignored`,
  // A failed outbox check ran again on connectivity and settled a lost write.
  `reconcile-retried`,
  // A sent follower write's removal failed and its writer kept waiting.
  `removal-failure-not-announced`,
  // The leader reported a saved row it could not decode.
  `unreadable-write-reported`,
  // An admission read spanning a change of leadership was dropped.
  `stale-admission-across-terms`,
  // A lost exclusion by beforeRetry still failed its writer.
  `exclusion-recovered`,
  // A failed rejection record was retried while other writes kept running.
  `outcome-record-retried`,
  // A late admission during an exclusion's cleanup sent nothing.
  `excluded-admission-ignored`,
  // An exclusion whose record failed kept its row for a later replay, and
  // an admission meanwhile sent nothing.
  `exclusion-cleanup-kept`,
  // A saved write removed before any leader sent it failed its writer.
  `removed-unsent-failed`,
  // A save acknowledged after a change of leadership was admitted by id.
  `save-acknowledged-after-handover`,
  // A former leader with a faulted executor saved a write for its successor.
  `faulted-former-leader-saved`,
  // A tab whose start failed released its channel and leadership.
  `failed-start-released`,
  // A save that finished after its tab closed still reached the leader.
  `save-announced-after-dispose`,
  // A save that finished after its writer began to lead was sent.
  `save-finished-after-gain`,
  // A rejection whose writer had closed kept its record.
  `orphan-rejection-kept`,
  // A tab that only observed a write left its rejection record in place.
  `observer-left-record`,
  // Clearing the outbox failed the writer of an unsent write.
  `cleared-unsent-failed`,
  // A write removed while its save was pending never ran.
  `removed-during-save`,
  // An outbox load that spanned a change of leadership scheduled nothing.
  `stale-load-dropped`,
  // A write removed while its server call ran kept the server's outcome.
  `removed-while-running-completed`,
  // A follower asked the leader to remove a write.
  `removal-forwarded`,
  // An exclusion cleanup that resumed after its leadership ended changed
  // nothing, and the next leader's send settled the write.
  `fenced-cleanup-yielded`,
  // The next leader also excluded the write, and the stalled record that
  // landed after its own still failed the writer.
  `fenced-cleanup-kept-rejection`,
  // A removal the leader never heard was made under the next leader, by that
  // leader itself or after the follower asked it again.
  `removal-made-by-new-leader`,
  `removal-resent-to-new-leader`,
  // A replacement executor settled its predecessor's write that another tab
  // completed or rejected meanwhile.
  `replacement-settled-success`,
  `replacement-settled-rejection`,
  // A replacement over another store left its predecessor's unsent write
  // pending.
  `replacement-other-store-waited`,
  // A write removed while its call ran stayed pending at a check made during
  // the call, then took the server's rejection.
  `removed-while-running-rejected`,
  // A writer whose saved row could not be decoded kept waiting.
  `unreadable-row-kept-waiting`,
  // A clear whose deletion of one row failed settled the other.
  `partial-clear-settled`,
  // A clear made under the next leader kept a write saved after it began.
  `clear-kept-later-write`,
  // A removal that failed during a save left the save to finish and send.
  `failed-removal-kept-save`,
  // A reconnect during a removal did not start the removed write.
  `removal-held-off-reconnect`,
  // A cleanup that failed after its leadership ended was not retried later.
  `stale-cleanup-not-retried`,
  // An exclusion whose deletion was still pending at a handover stayed an
  // exclusion under the next leader.
  `exclusion-decision-survived-handover`,
  // An exclusion whose decision had not landed at a handover gave way to the
  // next leader's send.
  `exclusion-yielded-to-successor`,
  // A removal decided before a handover was settled by the next leader, and
  // one not yet decided gave way to the next leader's send.
  `removal-decision-survived-handover`,
  `removal-yielded-to-successor`,
  // A removal decision that landed after the next leader settled the write
  // left no row for a later replay to reject.
  `stale-decision-left-no-row`,
  // A removal that yielded at a handover was made by the next leader.
  `yielded-removal-forwarded`,
  // A follower's removal that the leader yielded was asked again of the
  // next leader, which made it.
  `follower-removal-asked-again`,
  // An added message while a committed removal's deletion was pending sent
  // nothing.
  `committed-removal-not-admitted`,
  // A decision a successor adopted survived its first recorder withdrawing
  // its own, through a second handover.
  `adopted-decision-survived`,
  // A write whose call an intermediate replacement issued stayed pending at
  // a later replacement, then took the server's outcome.
  `issued-call-across-replacements`,
  // A call that finished before its removal's deletion acknowledged left no
  // running marker behind.
  `running-marker-retired`,
  // A committed decision whose row one leader could not decode survived
  // that leader's replay.
  `decision-kept-for-unreadable-row`,
  // An added message during a new leader's replay waited for it and sent
  // nothing decided.
  `admission-waited-for-replay`,
  // A follower that lost leadership during its replay left its pending
  // removal with the current leader.
  `pending-removal-left-to-leader`,
  // A default-mode removal whose deletion failed reported it and left the
  // write to send.
  `default-removal-failure-reported`,
  // An unreadable decision with no row did not stop a replay.
  `orphan-decision-ignored`,
  // An added message after a failed replay was refused, not sent.
  `admission-refused-after-failed-replay`,
  // An added message waited for a newer replay of the same tab.
  `admission-waited-for-newer-replay`,
  // Replacements that each added a Collection still saw an issued call.
  `issued-call-across-extended-replacements`,
  // Removing a write whose call succeeded but whose row stayed completed it.
  `removed-after-success-completed`,
  // A leader's own write removed while its call ran stayed pending across a
  // handover, then took the server's outcome.
  `own-running-removal-completed`,
  `own-running-removal-rejected`,
  // A durable replacement left a default-mode predecessor's write pending.
  `default-predecessor-unresolved`,
  // In the default mode, a write another leader rejected stayed pending in
  // its former leader, which cannot tell a rejection from a success.
  `former-leader-write-unresolved`,
  // A leader whose replay failed replayed again on connectivity and sent a
  // saved write without a handover.
  `replay-retried-on-connectivity`,
  // A replay that finished after a newer replay of the same tab left
  // admission open for the newer term.
  `stale-replay-kept-newer-term`,
  // Two removals of one running write each left a marker, and the call's
  // completion withdrew both.
  `overlapping-markers-retired`,
  // A rejection recorded after a writer listed the outcome records still
  // failed that writer.
  `rejection-recorded-after-listing`,
  // An unreadable outcome record before an intact rejection still failed
  // the writer.
  `rejection-read-past-unreadable-record`,
  // A decision with no readable error still settled its row.
  `decision-without-error-settled`,
  // A removed running write whose call failed with a retryable error failed
  // its writer through the recorded error.
  `removed-retryable-failure-recorded`,
  // An added message while an unsent write's removal was being decided sent
  // nothing.
  `unsent-removal-not-admitted`,
  // A removed running write's error, whose record failed, reached its writer
  // after its leader stopped leading.
  `removed-outcome-survived-handover`,
  // A connectivity change during an outbox check that then failed settled
  // the lost write.
  `check-retried-after-running-sweep`,
  // A removal whose read of a sent row's phase failed reported it and kept
  // the row.
  `phase-read-failure-kept-row`,
  // A readable decision beside an unreadable one kept its error.
  `readable-decision-kept`,
] as const
type ReachState = (typeof reachStates)[number]

type TabActionType =
  | `write`
  | `write-rejected`
  | `write-during-leader-message`
  | `write-save-fails`
  | `close`
  | `open`
  | `open-and-write`
  | `remove-unsent`
  | `clear-unsent`
  | `remove-running`
  | `removal-across-handover`
  | `remove-rejected-running`
  | `clear-across-handover`
type SharedActionType =
  | `online`
  | `offline`
  | `lose-settlement`
  | `stale-added`
  | `duplicate-added`
  | `fail-admission-read`
  | `fail-outbox-check`
  | `stale-admission-read`
  | `fail-removal`
  | `unreadable-added`
  | `stale-admission-across-terms`
  | `exclude-on-handover`
  | `fail-outcome-record`
  | `ack-after-handover`
  | `open-failing`
  | `dispose-during-save`
  | `save-after-gain`
  | `observe-rejection`
  | `remove-during-save`
  | `stale-load-across-terms`
  | `handover-rejection`
  | `exclusion-retry-across-handover`
  | `exclusion-retry-excluded-again`
  | `replace-writer`
  | `replace-rejected-writer`
  | `replace-writer-other-store`
  | `unreadable-saved-row`
  | `clear-partially-fails`
  | `failed-removal-during-save`
  | `remove-before-reconnect`
  | `failed-cleanup-across-terms`
  | `exclusion-across-handover-mid-delete`
  | `exclusion-across-handover-mid-mark`
  | `removal-mark-landed-handover`
  | `removal-mark-held-handover`
  | `removal-mark-held-late`
  | `removal-mark-held-offline`
  | `remove-deletion-pending`
  | `forwarded-removal-yields`
  | `added-during-committed-removal`
  | `adopted-decision-second-handover`
  | `replaced-twice-during-call`
  | `running-removal-completes-first`
  | `decision-row-undecodable`
  | `added-during-replay`
  | `removal-pending-replay-lost`
  | `default-removal-delete-fails`
  | `unreadable-orphan-decision`
  | `added-after-failed-replay`
  | `added-across-replays`
  | `replaced-twice-extended`
  | `remove-own-running`
  | `remove-own-rejected-running`
  | `replace-default-with-durable`
  | `replay-fails-then-reconnects`
  | `stale-replay-across-terms`
  | `overlapping-running-removals`
  | `rejection-after-outcome-listing`
  | `unreadable-outcome-before-rejection`
  | `decision-without-error`
  | `remove-running-retryable`
  | `added-during-unsent-removal`
  | `remove-running-record-fails-handover`
  | `connectivity-during-failing-check`
  | `remove-phase-read-fails`
  | `readable-decision-before-unreadable`
type Action = { type: TabActionType; tab: number } | { type: SharedActionType }
type Mode = `durable` | `online`
type History = { mode: Mode; actions: Array<Action> }

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const tabAction = (type: TabActionType) =>
  fc.record({ type: fc.constant(type), tab: fc.nat({ max: TABS - 1 }) })
const sharedAction = (type: SharedActionType) =>
  fc.record({ type: fc.constant(type) })
const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: tabAction(`write`) },
  { weight: 1, arbitrary: tabAction(`write-rejected`) },
  { weight: 1, arbitrary: tabAction(`write-during-leader-message`) },
  { weight: 1, arbitrary: tabAction(`write-save-fails`) },
  { weight: 2, arbitrary: tabAction(`close`) },
  { weight: 2, arbitrary: tabAction(`open`) },
  { weight: 1, arbitrary: tabAction(`open-and-write`) },
  { weight: 2, arbitrary: sharedAction(`offline`) },
  { weight: 2, arbitrary: sharedAction(`online`) },
  { weight: 1, arbitrary: sharedAction(`lose-settlement`) },
  { weight: 1, arbitrary: sharedAction(`stale-added`) },
  { weight: 1, arbitrary: sharedAction(`duplicate-added`) },
  { weight: 1, arbitrary: sharedAction(`fail-admission-read`) },
  { weight: 1, arbitrary: sharedAction(`fail-outbox-check`) },
  { weight: 1, arbitrary: sharedAction(`stale-admission-read`) },
  { weight: 1, arbitrary: sharedAction(`fail-removal`) },
  { weight: 1, arbitrary: sharedAction(`unreadable-added`) },
  { weight: 1, arbitrary: sharedAction(`stale-admission-across-terms`) },
  { weight: 1, arbitrary: sharedAction(`exclude-on-handover`) },
  { weight: 1, arbitrary: sharedAction(`fail-outcome-record`) },
  { weight: 1, arbitrary: tabAction(`remove-unsent`) },
  { weight: 1, arbitrary: sharedAction(`ack-after-handover`) },
  { weight: 1, arbitrary: sharedAction(`open-failing`) },
  { weight: 1, arbitrary: sharedAction(`dispose-during-save`) },
  { weight: 1, arbitrary: sharedAction(`save-after-gain`) },
  { weight: 1, arbitrary: sharedAction(`observe-rejection`) },
  { weight: 1, arbitrary: tabAction(`clear-unsent`) },
  { weight: 1, arbitrary: sharedAction(`remove-during-save`) },
  { weight: 1, arbitrary: sharedAction(`stale-load-across-terms`) },
  { weight: 1, arbitrary: sharedAction(`handover-rejection`) },
  { weight: 1, arbitrary: sharedAction(`exclusion-retry-across-handover`) },
  { weight: 1, arbitrary: sharedAction(`exclusion-retry-excluded-again`) },
  { weight: 1, arbitrary: tabAction(`removal-across-handover`) },
  { weight: 1, arbitrary: tabAction(`remove-rejected-running`) },
  { weight: 1, arbitrary: tabAction(`clear-across-handover`) },
  { weight: 1, arbitrary: sharedAction(`replace-writer-other-store`) },
  { weight: 1, arbitrary: sharedAction(`unreadable-saved-row`) },
  { weight: 1, arbitrary: sharedAction(`clear-partially-fails`) },
  { weight: 1, arbitrary: sharedAction(`failed-removal-during-save`) },
  { weight: 1, arbitrary: sharedAction(`remove-before-reconnect`) },
  { weight: 1, arbitrary: sharedAction(`failed-cleanup-across-terms`) },
  {
    weight: 1,
    arbitrary: sharedAction(`exclusion-across-handover-mid-delete`),
  },
  {
    weight: 1,
    arbitrary: sharedAction(`exclusion-across-handover-mid-mark`),
  },
  { weight: 1, arbitrary: sharedAction(`removal-mark-landed-handover`) },
  { weight: 1, arbitrary: sharedAction(`removal-mark-held-handover`) },
  { weight: 1, arbitrary: sharedAction(`removal-mark-held-late`) },
  { weight: 1, arbitrary: sharedAction(`removal-mark-held-offline`) },
  { weight: 1, arbitrary: sharedAction(`remove-deletion-pending`) },
  { weight: 1, arbitrary: sharedAction(`forwarded-removal-yields`) },
  { weight: 1, arbitrary: sharedAction(`added-during-committed-removal`) },
  { weight: 1, arbitrary: sharedAction(`adopted-decision-second-handover`) },
  { weight: 1, arbitrary: sharedAction(`replaced-twice-during-call`) },
  { weight: 1, arbitrary: sharedAction(`running-removal-completes-first`) },
  { weight: 1, arbitrary: sharedAction(`decision-row-undecodable`) },
  { weight: 1, arbitrary: sharedAction(`added-during-replay`) },
  { weight: 1, arbitrary: sharedAction(`removal-pending-replay-lost`) },
  { weight: 1, arbitrary: sharedAction(`default-removal-delete-fails`) },
  { weight: 1, arbitrary: sharedAction(`unreadable-orphan-decision`) },
  { weight: 1, arbitrary: sharedAction(`added-after-failed-replay`) },
  { weight: 1, arbitrary: sharedAction(`added-across-replays`) },
  { weight: 1, arbitrary: sharedAction(`replaced-twice-extended`) },
  { weight: 1, arbitrary: sharedAction(`remove-own-running`) },
  { weight: 1, arbitrary: sharedAction(`remove-own-rejected-running`) },
  { weight: 1, arbitrary: sharedAction(`replace-default-with-durable`) },
  { weight: 1, arbitrary: sharedAction(`replay-fails-then-reconnects`) },
  { weight: 1, arbitrary: sharedAction(`stale-replay-across-terms`) },
  { weight: 1, arbitrary: sharedAction(`overlapping-running-removals`) },
  { weight: 1, arbitrary: sharedAction(`rejection-after-outcome-listing`) },
  { weight: 1, arbitrary: sharedAction(`unreadable-outcome-before-rejection`) },
  { weight: 1, arbitrary: sharedAction(`decision-without-error`) },
  { weight: 1, arbitrary: sharedAction(`remove-running-retryable`) },
  { weight: 1, arbitrary: sharedAction(`added-during-unsent-removal`) },
  {
    weight: 1,
    arbitrary: sharedAction(`remove-running-record-fails-handover`),
  },
  { weight: 1, arbitrary: sharedAction(`connectivity-during-failing-check`) },
  { weight: 1, arbitrary: sharedAction(`remove-phase-read-fails`) },
  {
    weight: 1,
    arbitrary: sharedAction(`readable-decision-before-unreadable`),
  },
  { weight: 1, arbitrary: sharedAction(`replace-writer`) },
  { weight: 1, arbitrary: sharedAction(`replace-rejected-writer`) },
  { weight: 1, arbitrary: tabAction(`remove-running`) },
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  mode: fc.constantFrom<Mode>(`durable`, `durable`, `durable`, `online`),
  actions: fc.array(actionArbitrary, { maxLength: MAX_ACTIONS }),
})
// Actions that leave the tabs, leadership and connectivity as they were.
const BENIGN = new Set<string>([
  `write`,
  `write-rejected`,
  `open`,
  `online`,
  `stale-added`,
  `duplicate-added`,
])
const spliced = (
  generated: History,
  prefix: Array<Action>,
  mode: Mode = `durable`,
  // A state judged when the history ends keeps the generated tail benign.
  benign = false,
): History => ({
  mode,
  actions: [
    ...prefix,
    ...generated.actions
      .filter((action) => !benign || BENIGN.has(action.type))
      .filter(
        (action) =>
          action.type !== `lose-settlement` &&
          action.type !== `fail-admission-read` &&
          action.type !== `fail-outbox-check` &&
          action.type !== `stale-admission-read` &&
          action.type !== `fail-removal` &&
          action.type !== `unreadable-added` &&
          action.type !== `stale-admission-across-terms` &&
          action.type !== `exclude-on-handover` &&
          action.type !== `fail-outcome-record` &&
          action.type !== `remove-unsent` &&
          action.type !== `ack-after-handover` &&
          action.type !== `open-failing` &&
          action.type !== `dispose-during-save` &&
          action.type !== `save-after-gain` &&
          action.type !== `observe-rejection` &&
          action.type !== `clear-unsent` &&
          action.type !== `remove-during-save` &&
          action.type !== `stale-load-across-terms` &&
          action.type !== `handover-rejection` &&
          action.type !== `exclusion-retry-across-handover` &&
          action.type !== `exclusion-retry-excluded-again` &&
          action.type !== `removal-across-handover` &&
          action.type !== `remove-rejected-running` &&
          action.type !== `clear-across-handover` &&
          action.type !== `replace-writer-other-store` &&
          action.type !== `unreadable-saved-row` &&
          action.type !== `clear-partially-fails` &&
          action.type !== `failed-removal-during-save` &&
          action.type !== `remove-before-reconnect` &&
          action.type !== `failed-cleanup-across-terms` &&
          action.type !== `exclusion-across-handover-mid-delete` &&
          action.type !== `exclusion-across-handover-mid-mark` &&
          action.type !== `removal-mark-landed-handover` &&
          action.type !== `removal-mark-held-handover` &&
          action.type !== `removal-mark-held-late` &&
          action.type !== `removal-mark-held-offline` &&
          action.type !== `remove-deletion-pending` &&
          action.type !== `forwarded-removal-yields` &&
          action.type !== `added-during-committed-removal` &&
          action.type !== `adopted-decision-second-handover` &&
          action.type !== `replaced-twice-during-call` &&
          action.type !== `running-removal-completes-first` &&
          action.type !== `decision-row-undecodable` &&
          action.type !== `added-during-replay` &&
          action.type !== `removal-pending-replay-lost` &&
          action.type !== `default-removal-delete-fails` &&
          action.type !== `unreadable-orphan-decision` &&
          action.type !== `added-after-failed-replay` &&
          action.type !== `added-across-replays` &&
          action.type !== `replaced-twice-extended` &&
          action.type !== `remove-own-running` &&
          action.type !== `remove-own-rejected-running` &&
          action.type !== `replace-default-with-durable` &&
          action.type !== `replace-writer` &&
          action.type !== `replace-rejected-writer` &&
          action.type !== `replay-fails-then-reconnects` &&
          action.type !== `stale-replay-across-terms` &&
          action.type !== `overlapping-running-removals` &&
          action.type !== `rejection-after-outcome-listing` &&
          action.type !== `unreadable-outcome-before-rejection` &&
          action.type !== `decision-without-error` &&
          action.type !== `remove-running-retryable` &&
          action.type !== `added-during-unsent-removal` &&
          action.type !== `remove-running-record-fails-handover` &&
          action.type !== `connectivity-during-failing-check` &&
          action.type !== `remove-phase-read-fails` &&
          action.type !== `readable-decision-before-unreadable` &&
          action.type !== `remove-running`,
      )
      .slice(0, MAX_ACTIONS - prefix.length),
  ],
})

// ---------------------------------------------------------------------------
// Controlled environment
// ---------------------------------------------------------------------------

class ControlledElection {
  holder: TabElection | undefined
  readonly queue: Array<TabElection> = []

  leave(tab: TabElection): void {
    const index = this.queue.indexOf(tab)
    if (index >= 0) this.queue.splice(index, 1)
    if (this.holder !== tab) return
    this.holder = this.queue.shift()
    tab.set(false)
    this.holder?.set(true)
  }
}

class TabElection implements LeaderElection {
  private leader = false
  private readonly listeners = new Set<(isLeader: boolean) => void>()
  constructor(
    private readonly shared: ControlledElection,
    private readonly hold?: Promise<void>,
    // The request joins the election, then rejects.
    private readonly fail = false,
  ) {}

  async requestLeadership(): Promise<boolean> {
    await this.hold
    if (!this.shared.holder) {
      this.shared.holder = this
      this.leader = true
    } else if (
      this.shared.holder !== this &&
      !this.shared.queue.includes(this)
    ) {
      this.shared.queue.push(this)
    }
    if (this.fail) throw new Error(`leadership request failed`)
    return this.leader
  }
  releaseLeadership(): void {
    this.shared.leave(this)
  }
  isLeader(): boolean {
    return this.leader
  }
  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  set(isLeader: boolean): void {
    this.leader = isLeader
    for (const listener of this.listeners) listener(isLeader)
  }
  listenerCount(): number {
    return this.listeners.size
  }
}

class ControlledOnline {
  online = true
  readonly listeners = new Set<() => void>()

  detector(): OnlineDetector {
    const own = new Set<() => void>()
    return {
      subscribe: (callback) => {
        own.add(callback)
        this.listeners.add(callback)
        return () => {
          own.delete(callback)
          this.listeners.delete(callback)
        }
      },
      notifyOnline: () => {
        for (const listener of [...this.listeners]) listener()
      },
      isOnline: () => this.online,
      dispose: () => {
        for (const callback of own) this.listeners.delete(callback)
        own.clear()
      },
    }
  }
  set(online: boolean): void {
    this.online = online
    if (online) for (const listener of [...this.listeners]) listener()
  }
}

class ReadFailingStorage extends FakeStorageAdapter {
  failReads = 0
  // The next read of this key fails, after this many reads of it succeed.
  failReadKey: string | undefined
  failReadKeyAfter = 0
  // Transactions with a rejection record that landed.
  readonly recordedRejections = new Set<string>()
  // The next outcome record write fails.
  failOutcomeWrites = 0
  // Outcome keys whose write failed.
  readonly failedOutcomeKeys = new Set<string>()
  // The next outcome write waits for release, then lands.
  private heldOutcome: { release: (fail: boolean) => void } | null | undefined
  holdOutcomeWrite(): void {
    this.heldOutcome = null
  }
  releaseOutcomeWrite(fail = false): void {
    this.heldOutcome?.release(fail)
    this.heldOutcome = undefined
  }
  // Whether a write of any of this transaction's outcome records failed.
  outcomeFailed(transactionId: string): boolean {
    const prefix = `outcome:${encodeURIComponent(transactionId)}:`
    return [...this.failedOutcomeKeys].some((key) => key.startsWith(prefix))
  }
  // The next write lands at once and acknowledges on release.
  private heldAck: { release: () => void } | null | undefined
  holdNextAck(): void {
    this.heldAck = null
  }
  releaseAck(): void {
    this.heldAck?.release()
    this.heldAck = undefined
  }
  // The next read captures its value at once and returns it on release.
  private staleRead: { release: () => void } | null | undefined
  private heldWrites: Array<(fail: boolean) => void> | null = null

  holdWrites(): void {
    this.heldWrites = []
  }
  releaseWrites(fail: boolean): void {
    const held = this.heldWrites ?? []
    this.heldWrites = null
    for (const release of held) release(fail)
  }
  // The next key listing fails.
  failKeys = 0
  override async keys(): Promise<Array<string>> {
    if (this.failKeys > 0) {
      this.failKeys -= 1
      throw new Error(`storage keys failed`)
    }
    return super.keys()
  }
  failDeletes = 0
  // The next row deletion waits for release.
  private heldDelete: { release: () => void } | null | undefined
  holdNextDelete(): void {
    this.heldDelete = null
  }
  releaseDelete(): void {
    this.heldDelete?.release()
    this.heldDelete = undefined
  }
  // Whether a held row deletion reached its gate.
  deleteHeld(): boolean {
    return this.heldDelete !== null && this.heldDelete !== undefined
  }
  // The next removal decision write fails, or waits for release: before it
  // lands, or after.
  failDecisionWrites = 0
  private heldDecision:
    | { release: (fail: boolean) => void; landed: boolean }
    | { landFirst: boolean }
    | undefined
  holdNextDecision(landFirst = false): void {
    this.heldDecision = { landFirst }
  }
  // Whether a held decision write reached the gate.
  decisionHeld(): boolean {
    return this.heldDecision !== undefined && `release` in this.heldDecision
  }
  releaseDecision(fail = false): void {
    if (this.heldDecision && `release` in this.heldDecision)
      this.heldDecision.release(fail)
    this.heldDecision = undefined
  }
  override async delete(key: string): Promise<void> {
    if (this.failDeletes > 0 && key.startsWith(`tx:`)) {
      this.failDeletes -= 1
      throw new Error(`storage delete failed`)
    }
    if (this.heldDelete === null && key.startsWith(`tx:`)) {
      await new Promise<void>((release) => {
        this.heldDelete = { release }
      })
    }
    return super.delete(key)
  }
  override async set(key: string, value: string): Promise<void> {
    if (this.failOutcomeWrites > 0 && key.startsWith(`outcome:`)) {
      this.failOutcomeWrites -= 1
      this.failedOutcomeKeys.add(key)
      throw new Error(`storage write failed`)
    }
    if (this.heldOutcome === null && key.startsWith(`outcome:`)) {
      const fail = await new Promise<boolean>((release) => {
        this.heldOutcome = { release }
      })
      if (fail) {
        this.failedOutcomeKeys.add(key)
        throw new Error(`storage write failed`)
      }
    }
    if (this.failDecisionWrites > 0 && key.startsWith(`decision:`)) {
      this.failDecisionWrites -= 1
      throw new Error(`storage write failed`)
    }
    if (
      this.heldDecision &&
      `landFirst` in this.heldDecision &&
      key.startsWith(`decision:`)
    ) {
      const { landFirst } = this.heldDecision
      if (landFirst) await super.set(key, value)
      const fail = await new Promise<boolean>((release) => {
        this.heldDecision = { release, landed: landFirst }
      })
      if (landFirst) return
      if (fail) throw new Error(`storage write failed`)
    }
    if (this.heldAck === null && key.startsWith(`tx:`)) {
      await super.set(key, value)
      await new Promise<void>((release) => {
        this.heldAck = { release }
      })
      return
    }
    if (this.heldWrites) {
      const held = this.heldWrites
      const fail = await new Promise<boolean>((resolve) => held.push(resolve))
      if (fail) throw new Error(`storage write failed`)
    }
    await super.set(key, value)
    if (key.startsWith(`outcome:`) && value.includes(`"error"`))
      this.recordedRejections.add(decodeURIComponent(key.split(`:`)[1]!))
  }
  holdNextRead(): void {
    this.staleRead = null
  }
  releaseRead(): void {
    this.staleRead?.release()
    this.staleRead = undefined
  }
  override async get(key: string): Promise<string | null> {
    if (this.failReadKey === key) {
      if (this.failReadKeyAfter > 0) this.failReadKeyAfter -= 1
      else {
        this.failReadKey = undefined
        throw new Error(`storage read failed`)
      }
    }
    if (this.failReads > 0) {
      this.failReads -= 1
      throw new Error(`storage read failed`)
    }
    if (this.staleRead === null) {
      const value = await super.get(key)
      await new Promise<void>((release) => {
        this.staleRead = { release }
      })
      return value
    }
    return super.get(key)
  }
}

// Another adapter object over the same stored data.
class StorageView implements StorageAdapter {
  constructor(private readonly target: StorageAdapter) {}
  // Reads of this tab only that capture their value, then wait for release.
  private readHolds = 0
  private readonly heldReads: Array<() => void> = []
  holdNextRead(): void {
    this.readHolds += 1
  }
  releaseRead(): void {
    this.heldReads.shift()?.()
  }
  async get(key: string) {
    if (this.readHolds === 0) return this.target.get(key)
    this.readHolds -= 1
    const value = await this.target.get(key)
    await new Promise<void>((release) => this.heldReads.push(release))
    return value
  }
  set(key: string, value: string) {
    return this.target.set(key, value)
  }
  delete(key: string) {
    return this.target.delete(key)
  }
  // Key listings of this tab only that are taken at once, then wait for
  // release.
  private keyHolds = 0
  private readonly heldKeys: Array<() => void> = []
  holdNextKeys(): void {
    this.keyHolds += 1
  }
  keysHeld(): boolean {
    return this.heldKeys.length > 0
  }
  releaseKeys(): void {
    this.heldKeys.shift()?.()
  }
  async keys() {
    if (this.keyHolds === 0) return this.target.keys()
    this.keyHolds -= 1
    const listed = await this.target.keys()
    await new Promise<void>((release) => this.heldKeys.push(release))
    return listed
  }
  clear() {
    return this.target.clear()
  }
}

// A Collection a replacement executor registers in addition.
function extraCollection(id: string) {
  return createCollection<{ id: string }, string, {}>({
    id,
    getKey: (item) => item.id,
    startSync: true,
    sync: { sync: ({ markReady }) => markReady() },
  })
}

type ChannelMessage = { type: string; id?: string; error?: unknown }

function controlledChannels() {
  const open = new Set<ControlledChannel>()
  const state = {
    loseSettlement: false,
    loseRemoval: false,
    loseLeader: false,
    lost: 0,
    lostIds: [] as Array<string>,
    created: 0,
  }
  // Only channels with the sender's name hear it, as with BroadcastChannel.
  const deliver = (from: ControlledChannel | null, data: ChannelMessage) => {
    const copy = structuredClone(data)
    const name = from?.name ?? CHANNEL
    for (const channel of open) {
      if (channel === from || channel.name !== name) continue
      setTimeout(() => {
        if (open.has(channel)) channel.onmessage?.({ data: copy })
      }, 0)
    }
  }
  class ControlledChannel {
    onmessage: ((event: { data: ChannelMessage }) => void) | null = null
    constructor(readonly name: string) {
      // A tab that registers more Collections names a longer channel.
      expect(name.startsWith(CHANNEL), `channel name`).toBe(true)
      state.created += 1
      open.add(this)
    }
    postMessage(data: ChannelMessage): void {
      if (state.loseLeader && data.type === `leader`) {
        state.loseLeader = false
        return
      }
      if (state.loseRemoval && data.type === `remove`) {
        state.loseRemoval = false
        return
      }
      if (state.loseSettlement && data.type === `settled`) {
        state.loseSettlement = false
        state.lost += 1
        state.lostIds.push(data.id!)
        return
      }
      deliver(this, data)
    }
    close(): void {
      open.delete(this)
    }
  }
  return {
    ControlledChannel,
    state,
    openCount: () => open.size,
    inject: (data: ChannelMessage) => deliver(null, data),
  }
}

const settle = async () => {
  for (let turn = 0; turn < 12; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

type Write = {
  id: string
  transactionId?: string
  tab: number
  rejected: boolean
  deliverable: boolean
  fromFollower: boolean
  session: number
  // Made before its tab initialized, so it took the online path.
  preInit: boolean
  // The session of the leader whose admission read failed, until
  // connectivity changes.
  unadmittedBy?: number
  // A failed outbox check found this lost write pending.
  checkFailed: boolean
  // Its admission read failed at some point in the history.
  retried?: boolean
  // The next leader's beforeRetry excluded it.
  excluded?: boolean
  // That exclusion's rejection record failed, so its row stayed.
  exclusionKept?: boolean
  // removeFromOutbox removed it before any leader sent it.
  removed?: boolean
  // Its rejection record failed once.
  recordRetried?: boolean
  // Another leader settled it in the default mode; its tab cannot tell how.
  unresolved?: boolean
  // It fails with this error rather than a rejection from the server.
  failure?: string
  outcome?: `completed` | `failed`
  error?: unknown
}

const warningsFor =
  (warn: { mock: { calls: Array<Array<unknown>> } }) => (text: string) =>
    warn.mock.calls.filter(([message]) => message === text).length

async function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  const channels = controlledChannels()
  vi.stubGlobal(`BroadcastChannel`, channels.ControlledChannel)
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const warnings = warningsFor(warn)
  const durable = history.mode === `durable`
  const storage = new ReadFailingStorage()
  const election = new ControlledElection()
  const online = new ControlledOnline()
  const writes: Array<Write> = []
  const calls: Array<string> = []
  // Which tab called the server for each write, and which tab led then.
  const sends: Array<{ id: string; sender: number; leader?: number }> = []
  const rejected = new Set<string>()
  // Writes whose next server call fails with a retryable error.
  const retryable = new Set<string>()
  // Writes a new leader's beforeRetry excludes, by write id.
  const excluded = new Set<string>()
  const expectedWarnings = { admission: 0, check: 0 }
  type Tab = {
    env: ReturnType<typeof createTestOfflineEnvironment>
    election: TabElection
    session: number
    // This tab's own way to the stored data.
    view: StorageView
  }
  const tabs: Array<Tab | undefined> = Array.from({ length: TABS })
  let sessions = 0
  // The next server call waits for this before it answers.
  let callGate: Promise<void> | null = null

  const openTab = async (
    index: number,
    beforeInit?: () => Promise<void>,
    hold?: Promise<void>,
    // `load`: it leads, then its outbox load fails.
    failStart: boolean | `load` = false,
    // A replacement keeps its predecessor's collection.
    collection?: ReturnType<typeof createTestOfflineEnvironment>[`collection`],
    // A replacement may reach the outbox through another adapter.
    tabStorage: StorageAdapter = storage,
    // A durable tab in a default-mode history.
    durableTab = durable,
    // Collections a replacement registers beyond the shared one.
    extra?: Record<string, ReturnType<typeof extraCollection>>,
  ) => {
    const view = new StorageView(tabStorage)
    const tabElection = new TabElection(election, hold, failStart === true)
    const session = ++sessions
    const env = createTestOfflineEnvironment({
      storage: view as unknown as FakeStorageAdapter,
      // Each tab names its collection differently under the shared key.
      collectionId: `items-${session}`,
      collection,
      registryKey: `test-items`,
      mutationFn: (params: OfflineMutationFnParams) => {
        const id = String(params.transaction.mutations[0].key)
        // The server is unreachable while offline, whichever path sends it.
        if (!online.online) throw new Error(`offline`)
        calls.push(id)
        sends.push({
          id,
          sender: session,
          leader: tabs[leaderIndex()]?.session,
        })
        if (callGate) {
          const gate = callGate
          callGate = null
          return gate.then(() => {
            if (rejected.has(id)) throw new NonRetriableError(`rejected ${id}`)
            if (retryable.delete(id)) throw new Error(`retry ${id}`)
            return { ok: true }
          })
        }
        if (rejected.has(id)) throw new NonRetriableError(`rejected ${id}`)
        return { ok: true }
      },
      config: {
        ...(durableTab ? { followerWrites: `durable` } : {}),
        ...(extra ? { collections: extra } : {}),
        leaderElection: tabElection,
        onlineDetector: online.detector(),
        beforeRetry: (
          transactions: Array<{ mutations: Array<{ key: unknown }> }>,
        ) =>
          transactions.filter(
            (transaction) =>
              !excluded.has(String(transaction.mutations[0]!.key)),
          ),
        jitter: false,
      } as never,
    })
    tabs[index] = { env, election: tabElection, session, view }
    await beforeInit?.()
    if (failStart) {
      await expect(
        env.executor.waitForInit(),
        `a failed start rejects`,
      ).rejects.toBeInstanceOf(Error)
    } else await env.executor.waitForInit()
    await settle()
  }
  // Leadership moves tab to tab until `target` leads, at least once.
  const rotateTo = async (target: TabElection) => {
    for (let turn = 0; turn < TABS + 1; turn++) {
      const holder = election.holder!
      if (turn > 0 && holder === target) return
      holder.releaseLeadership()
      await settle()
      await holder.requestLeadership()
      await settle()
    }
  }
  const closeTab = async (index: number) => {
    const tab = tabs[index]
    if (!tab) return
    tabs[index] = undefined
    expect(() => tab.env.executor.dispose(), `close tab ${index}`).not.toThrow()
    await settle()
  }
  // The outcome records stored for a transaction.
  const outcomesOf = async (transactionId: string) => {
    const prefix = `outcome:${encodeURIComponent(transactionId)}:`
    return Promise.all(
      (await storage.keys())
        .filter((key) => key.startsWith(prefix))
        .map(
          async (key) =>
            JSON.parse((await storage.get(key))!) as {
              error?: { name: string; message: string }
              pending?: true
            },
        ),
    )
  }
  const isUnsent = (write: Write) =>
    write.deliverable && !calls.includes(write.id)
  const leaderIndex = () =>
    tabs.findIndex((tab) => tab && tab.election === election.holder)
  const openSessions = () => new Set(tabs.flatMap((tab) => tab?.session ?? []))
  // No earlier write is queued or retrying a cleanup, nothing is armed to
  // fail or be lost, so an action's writes are sent at once and its
  // outcome is its own.
  const quiet = async () => {
    if (
      writes.some(isUnsent) ||
      storage.failOutcomeWrites > 0 ||
      channels.state.loseSettlement
    )
      return false
    const leader = tabs[leaderIndex()]
    return !leader || (await leader.env.executor.peekOutbox()).length === 0
  }

  const check = (label: string) => {
    expect(
      [...warn.mock.calls, ...consoleError.mock.calls]
        .flat()
        .filter((value) => value instanceof TypeError),
      `${label}: no internal TypeError`,
    ).toEqual([])
    expect(channels.openCount(), `${label}: open channels`).toBe(
      durable ? tabs.filter(Boolean).length : 0,
    )
    expect(warnings(`Failed to run follower write:`), `${label}: admit`).toBe(
      expectedWarnings.admission,
    )
    expect(
      warnings(`Failed to reconcile follower writes:`),
      `${label}: outbox check`,
    ).toBe(expectedWarnings.check)
    if (!durable) return
    const sessionsOpen = openSessions()
    const leader = tabs[leaderIndex()]
    for (const write of writes) {
      if (!isUnsent(write)) continue
      if (sessionsOpen.has(write.session)) {
        expect(write.outcome, `${label}: ${write.id} stays pending`).toBe(
          undefined,
        )
      }
      if (leader && write.unadmittedBy !== leader.session) {
        expect(
          leader.env.collection.has(write.id),
          `${label}: leader shows ${write.id}`,
        ).toBe(true)
      }
    }
  }

  type WriteType =
    | `write`
    | `write-rejected`
    | `write-during-leader-message`
    | `write-save-fails`
  const doWrite = async (
    index: number,
    type: WriteType,
    preInit = false,
  ): Promise<Write | undefined> => {
    const tab = tabs[index]
    if (!tab) return undefined
    const fromFollower = leaderIndex() !== index
    const id = `write-${writes.length}`
    // Durable writes go through the shared outbox once the tab is ready.
    const shared = durable && !preInit
    const write: Write = {
      id,
      tab: index,
      rejected: type === `write-rejected`,
      deliverable: shared || (!preInit && !fromFollower) || online.online,
      fromFollower,
      session: tab.session,
      preInit,
      checkFailed: false,
    }
    writes.push(write)
    if (write.rejected) rejected.add(id)
    const saveFails = shared && type === `write-save-fails`
    const heldSave =
      saveFails || (shared && type === `write-during-leader-message`)
    if (saveFails) write.deliverable = false
    if (heldSave) storage.holdWrites()
    if (!durable && !fromFollower && online.online) {
      reach(`online-mode-leader-write-delivered`)
    }
    if (!durable && fromFollower && !online.online) {
      reach(`online-mode-follower-write-failed`)
    }
    const transaction = tab.env.executor.createOfflineTransaction({
      mutationFnName: tab.env.mutationFnName,
      autoCommit: false,
    })
    write.transactionId = transaction.id
    const settled = transaction.mutate(() => {
      tab.env.collection.insert({
        id,
        value: id,
        completed: false,
        updatedAt: new Date(),
      })
    })
    void transaction.commit().catch(() => undefined)
    void settled.when(`settled`).then(
      () => {
        write.outcome = `completed`
      },
      (error: unknown) => {
        write.outcome = `failed`
        write.error = error
      },
    )
    await settle()
    if (heldSave) {
      channels.inject({ type: `leader` })
      await settle()
      expect(write.outcome, `${id} waits for its save`).toBe(undefined)
      reach(`leader-message-during-save`)
      if (saveFails && fromFollower) reach(`follower-save-failed`)
      storage.releaseWrites(saveFails)
      await settle()
    }
    return write
  }

  try {
    for (let index = 0; index < TABS; index++) await openTab(index)
    expect(channels.state.created, `channels created`).toBe(durable ? TABS : 0)

    for (const [step, action] of history.actions.entries()) {
      switch (action.type) {
        case `write`:
        case `write-rejected`:
        case `write-during-leader-message`:
        case `write-save-fails`:
          await doWrite(action.tab, action.type)
          break
        case `close`: {
          const leader = leaderIndex() === action.tab
          if (
            durable &&
            leader &&
            writes.some((write) => write.tab !== action.tab && isUnsent(write))
          ) {
            reach(`leader-closed-with-follower-write`)
          }
          if (
            durable &&
            !leader &&
            writes.some(
              (write) =>
                write.tab === action.tab &&
                write.session === tabs[action.tab]?.session &&
                isUnsent(write),
            )
          ) {
            reach(`write-outlived-its-tab`)
          }
          await closeTab(action.tab)
          break
        }
        case `open`:
          if (!tabs[action.tab]) await openTab(action.tab)
          break
        case `open-and-write`: {
          if (tabs[action.tab]) break
          // The write lands after the tab opens its channel, while its
          // election is still pending.
          let release!: () => void
          const hold = new Promise<void>((resolve) => {
            release = resolve
          })
          let made: Promise<Write | undefined> | undefined
          const channelsBefore = channels.state.created
          await openTab(
            action.tab,
            async () => {
              for (let turn = 0; turn < 50; turn++) {
                if (!durable || channels.state.created > channelsBefore) break
                await new Promise((resolve) => setTimeout(resolve, 0))
              }
              if (durable)
                expect(channels.state.created, `channel opened`).toBe(
                  channelsBefore + 1,
                )
              made = doWrite(action.tab, `write`, true)
              await Promise.resolve()
              release()
            },
            hold,
          )
          if (await made) reach(`pre-initialization-write`)
          break
        }
        case `online`:
          online.set(true)
          await settle()
          for (const write of writes) write.unadmittedBy = undefined
          break
        case `offline`:
          online.set(false)
          break
        case `lose-settlement`:
          if (durable) channels.state.loseSettlement = true
          break
        case `stale-added`:
          if (!durable || !tabs.some(Boolean)) break
          reach(`stale-message-ignored`)
          channels.inject({ type: `added`, id: `not-in-outbox` })
          await settle()
          break
        case `duplicate-added`: {
          const queued = writes.find(isUnsent)
          if (!durable || !queued || leaderIndex() < 0) break
          reach(`duplicate-message-ignored`)
          channels.inject({ type: `added`, id: queued.transactionId })
          await settle()
          break
        }
        case `fail-admission-read`: {
          // The leader's first read of a follower's saved write fails.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || leaderIndex() < 0 || follower < 0) break
          reach(`admission-read-failed`)
          storage.failReads = 1
          expectedWarnings.admission += 1
          const leaderSession = tabs[leaderIndex()]!.session
          const write = await doWrite(follower, `write`)
          write!.unadmittedBy = leaderSession
          write!.retried = true
          break
        }
        case `stale-admission-read`: {
          // The leader's admission read stalls with the saved row; a duplicate
          // message sends and removes the write before the read returns.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || !online.online || leaderIndex() < 0 || follower < 0)
            break
          storage.holdNextRead()
          const write = await doWrite(follower, `write`)
          if (!write) break
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          storage.releaseRead()
          await settle()
          if (calls.includes(write.id)) reach(`stale-admission-ignored`)
          break
        }
        case `fail-removal`: {
          // The leader sends a follower's write, then fails to remove its row.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || !online.online || leaderIndex() < 0 || follower < 0)
            break
          if (!(await quiet())) break
          storage.failDeletes = 1
          const write = await doWrite(follower, `write`)
          // A queue still busy with earlier writes leaves the fault unused.
          if (!write || !calls.includes(write.id)) {
            storage.failDeletes = 0
            break
          }
          expect(write.outcome, `${write.id} waits after a cleanup fault`).toBe(
            undefined,
          )
          reach(`removal-failure-not-announced`)
          // The faulted leader stays open as a follower; the next leader
          // finishes the removal. A write from the faulted tab is saved for
          // that leader, which sends it.
          const faulted = leaderIndex()
          // While it leads, its fault refuses its own writes.
          const refused = await doWrite(faulted, `write`)
          if (refused) {
            refused.deliverable = false
            expect(refused.outcome, `${refused.id} refused by a fault`).toBe(
              `failed`,
            )
          }
          const successor = tabs.findIndex(
            (tab, index) => tab && index !== faulted,
          )
          await rotateTo(tabs[successor]!.election)
          const saved = await doWrite(faulted, `write`)
          if (saved) {
            expect(calls, `${saved.id} sent for the faulted tab`).toContain(
              saved.id,
            )
            reach(`faulted-former-leader-saved`)
          }
          await closeTab(faulted)
          break
        }
        case `unreadable-added`: {
          // A saved row this leader cannot decode is reported, not dropped.
          if (!durable || leaderIndex() < 0) break
          await storage.set(
            `tx:unreadable`,
            JSON.stringify({ id: `unreadable` }),
          )
          expectedWarnings.admission += 1
          channels.inject({ type: `added`, id: `unreadable` })
          await settle()
          expect(
            await storage.get(`tx:unreadable`),
            `the unreadable row is kept`,
          ).toBe(JSON.stringify({ id: `unreadable` }))
          reach(`unreadable-write-reported`)
          await storage.delete(`tx:unreadable`)
          break
        }
        case `stale-admission-across-terms`: {
          // The leader's admission read stalls. Leadership moves away, another
          // leader sends and removes the write, and leadership comes back
          // before the read returns.
          const first = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== first)
          if (
            !durable ||
            !online.online ||
            first < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3
          )
            break
          storage.holdNextRead()
          const write = await doWrite(writer, `write`)
          if (!write) break
          const original = tabs[first]!.election
          await rotateTo(original)
          expect(election.holder, `the original tab leads again`).toBe(original)
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `another leader removed ${write.id}`,
          ).toBe(null)
          storage.releaseRead()
          await settle()
          if (calls.includes(write.id)) reach(`stale-admission-across-terms`)
          break
        }
        case `exclude-on-handover`: {
          // An offline follower write waits; its settlement is lost when the
          // next leader's beforeRetry excludes it.
          // The writer stays a follower, so it learns the exclusion only
          // from the record. In the default mode a follower's write is not
          // saved, so the leader writes and closes, and no record is kept.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = durable
            ? tabs.findIndex(
                (tab, index) =>
                  tab && index !== leader && tab.election !== next,
              )
            : leader
          if (leader < 0 || writer < 0 || tabs.filter(Boolean).length < 3) break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          excluded.add(write.id)
          write.excluded = true
          write.deliverable = false
          channels.state.loseSettlement = true
          // The exclusion's record stalls, and an admission arrives meanwhile.
          if (durable) storage.holdWrites()
          await closeTab(leader)
          if (durable) {
            channels.inject({ type: `added`, id: write.transactionId })
            await settle()
            reach(`excluded-admission-ignored`)
            storage.releaseWrites(false)
            await settle()
            // A leftover record fault: the row stays for a later replay to
            // decide, and an admission meanwhile sends nothing.
            if (storage.outcomeFailed(write.transactionId!)) {
              write.exclusionKept = true
              const holder = tabs[leaderIndex()]
              if (holder) {
                expect(
                  (await holder.env.executor.peekOutbox()).map(({ id }) => id),
                  `${write.id} kept for a later replay`,
                ).toContain(write.transactionId)
              }
              channels.inject({ type: `added`, id: write.transactionId })
              await settle()
              // The leader retries the cleanup without a handover: at once on
              // reconnecting, which fails again here, then on its timer.
              channels.state.loseSettlement = false
              storage.failOutcomeWrites = 1
              online.set(true)
              await settle()
              expect(
                storage.failOutcomeWrites,
                `the reconnect retried ${write.id}'s cleanup`,
              ).toBe(0)
              await new Promise((resolve) => setTimeout(resolve, 1100))
              await settle()
              if (holder) {
                expect(
                  (await holder.env.executor.peekOutbox()).map(({ id }) => id),
                  `${write.id} removed by the retried cleanup`,
                ).not.toContain(write.transactionId)
              }
              expect(write.outcome, `${write.id} fails after the retry`).toBe(
                `failed`,
              )
              reach(`exclusion-cleanup-kept`)
            }
          }
          channels.state.loseSettlement = false
          if (write.outcome === `failed`) reach(`exclusion-recovered`)
          break
        }
        case `fail-outcome-record`: {
          // A follower's write is rejected, its rejection record fails, and
          // another write after it still runs.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || !online.online || leaderIndex() < 0 || follower < 0)
            break
          // The first retry fails too; a later one records the rejection.
          storage.failOutcomeWrites = 2
          const rejectedWrite = await doWrite(follower, `write-rejected`)
          const next = await doWrite(follower, `write`)
          // The later write waits its turn behind the rejected one, which
          // retries its cleanup; the history's end checks that both settle.
          if (!rejectedWrite || !next || !calls.includes(rejectedWrite.id)) {
            storage.failOutcomeWrites = 0
            break
          }
          rejectedWrite.recordRetried = true
          break
        }
        case `remove-unsent`: {
          // A tab removes a follower's saved write before any leader sent it.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          const remover = tabs[action.tab] ? action.tab : leader
          online.set(false)
          const write = await doWrite(follower, `write`)
          if (!write) break
          if (remover !== leaderIndex()) reach(`removal-forwarded`)
          await tabs[remover]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          // Removing a row that is already gone records nothing.
          const gone = writes.find(
            (candidate) =>
              candidate !== write &&
              candidate.transactionId !== undefined &&
              calls.includes(candidate.id),
          )
          if (gone)
            await tabs[remover]!.env.executor.removeFromOutbox(
              gone.transactionId!,
            )
          write.removed = true
          write.deliverable = false
          await settle()
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`removed-unsent-failed`)
          break
        }
        case `ack-after-handover`: {
          // A follower's row lands but its save acknowledges only after
          // another leader sent and removed it and the writer then leads.
          // The writer waits behind the next leader, which sends the write.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          storage.holdNextAck()
          const write = await doWrite(writer, `write`)
          if (!write) {
            storage.releaseAck()
            break
          }
          await rotateTo(tabs[writer]!.election)
          const send = sends.find((candidate) => candidate.id === write.id)
          expect(send?.sender, `${write.id} sent by another leader`).not.toBe(
            undefined,
          )
          expect(send?.sender, `${write.id} not sent by its writer`).not.toBe(
            write.session,
          )
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `${write.id} removed before its acknowledgment`,
          ).toBe(null)
          storage.releaseAck()
          await settle()
          reach(`save-acknowledged-after-handover`)
          break
        }
        case `open-failing`: {
          // A tab whose start fails leaves no channel open, no claim on
          // leadership and no listener, without being disposed. With no
          // leader it leads, and its outbox load fails after setup.
          const index = tabs.findIndex((tab) => !tab)
          if (!durable || index < 0 || !(await quiet())) break
          const before = channels.openCount()
          const listenersBefore = online.listeners.size
          const failLoad = leaderIndex() < 0
          if (failLoad) storage.failKeys = 1
          await openTab(index, undefined, undefined, failLoad ? `load` : true)
          const failed = tabs[index]!
          expect(channels.openCount(), `a failed start keeps no channel`).toBe(
            before,
          )
          expect(
            online.listeners.size,
            `a failed start keeps no connectivity listener`,
          ).toBe(listenersBefore)
          expect(
            failed.election.listenerCount(),
            `a failed start keeps no leadership listener`,
          ).toBe(0)
          expect(
            election.holder !== failed.election &&
              !election.queue.includes(failed.election),
            `a failed start keeps no leadership claim`,
          ).toBe(true)
          reach(`failed-start-released`)
          tabs[index] = undefined
          failed.env.executor.dispose()
          await settle()
          break
        }
        case `dispose-during-save`: {
          // A follower closes while its save runs; the save still reaches
          // the current leader, which sends it.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          storage.holdWrites()
          const write = await doWrite(follower, `write`)
          if (!write) break
          await closeTab(follower)
          storage.releaseWrites(false)
          await settle()
          expect(calls, `${write.id} sent after its tab closed`).toContain(
            write.id,
          )
          reach(`save-announced-after-dispose`)
          break
        }
        case `save-after-gain`: {
          // A follower's save lands only after it began to lead, so its
          // leadership load missed the row; the save still sends it.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            writer < 0 ||
            !(await quiet())
          )
            break
          storage.holdWrites()
          const write = await doWrite(writer, `write`)
          if (!write) {
            storage.releaseWrites(false)
            break
          }
          await rotateTo(tabs[writer]!.election)
          storage.releaseWrites(false)
          await settle()
          expect(calls, `${write.id} sent after its save`).toContain(write.id)
          reach(`save-finished-after-gain`)
          break
        }
        case `observe-rejection`: {
          // The leader also waits on a follower's rejected write. The writer
          // misses the settlement and learns the rejection from its record.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (!durable || leader < 0 || writer < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(writer, `write-rejected`)
          if (!write) break
          const observed = tabs[
            leader
          ]!.env.executor.waitForTransactionCompletion(
            write.transactionId!,
          ).catch(() => undefined)
          channels.state.loseSettlement = true
          online.set(true)
          await settle()
          await observed
          channels.state.loseSettlement = false
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} fails from its record`).toBe(
            `failed`,
          )
          reach(`observer-left-record`)
          break
        }
        case `clear-unsent`: {
          // A tab clears the outbox while a follower's write is unsent.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          const remover = tabs[action.tab] ? action.tab : leader
          const executor = tabs[remover]!.env.executor
          if ((await executor.peekOutbox()).length > 0) break
          if (remover !== leader) reach(`removal-forwarded`)
          online.set(false)
          const write = await doWrite(follower, `write`)
          if (!write) break
          await executor.clearOutbox()
          write.removed = true
          write.deliverable = false
          await settle()
          expect(write.outcome, `${write.id} fails when cleared`).toBe(`failed`)
          reach(`cleared-unsent-failed`)
          break
        }
        case `remove-during-save`: {
          // The leader's own row lands, the leader removes it, and only then
          // does its save acknowledge.
          const leader = leaderIndex()
          if (leader < 0 || !online.online || !(await quiet())) break
          storage.holdNextAck()
          const write = await doWrite(leader, `write`)
          if (!write) {
            storage.releaseAck()
            break
          }
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          write.removed = true
          write.deliverable = false
          storage.releaseAck()
          await settle()
          expect(calls, `${write.id} never runs`).not.toContain(write.id)
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`removed-during-save`)
          break
        }
        case `stale-load-across-terms`: {
          // The next leader's outbox load stalls with a follower's row in it.
          // Leadership moves on, another leader sends and removes the write,
          // and the stalled tab leads again before its load returns.
          const first = leaderIndex()
          const target = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== first && tab.election !== target,
          )
          if (
            !durable ||
            first < 0 ||
            !target ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          const firstElection = tabs[first]!.election
          storage.holdNextRead()
          firstElection.releaseLeadership()
          await settle()
          await firstElection.requestLeadership()
          online.set(true)
          await settle()
          target.releaseLeadership()
          await settle()
          await target.requestLeadership()
          await settle()
          expect(calls, `${write.id} sent by another leader`).toContain(
            write.id,
          )
          await rotateTo(target)
          expect(election.holder, `the stalled tab leads again`).toBe(target)
          storage.releaseRead()
          await settle()
          reach(`stale-load-dropped`)
          break
        }
        case `handover-rejection`: {
          // In the default mode the leader saves its own write offline, loses
          // leadership, and another leader's server call rejects it.
          const leader = leaderIndex()
          if (
            durable ||
            leader < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(leader, `write-rejected`)
          if (!write) break
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          online.set(true)
          await settle()
          expect(calls, `${write.id} sent by another leader`).toContain(
            write.id,
          )
          expect(write.outcome, `${write.id} waits for its tab to lead`).toBe(
            undefined,
          )
          await rotateTo(original)
          // No record tells a rejection from a success, so it keeps waiting.
          expect(write.outcome, `${write.id} stays pending`).toBe(undefined)
          write.unresolved = true
          reach(`former-leader-write-unresolved`)
          break
        }
        case `remove-running`:
        case `remove-rejected-running`: {
          // A tab removes a follower's write while the leader's server call
          // runs, a check runs during the call, and the settlement message
          // is lost.
          const rejectedRun = action.type === `remove-rejected-running`
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(
            follower,
            rejectedRun ? `write-rejected` : `write`,
          )
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          const remover = tabs[action.tab] ? action.tab : leader
          if (remover !== leader) reach(`removal-forwarded`)
          await tabs[remover]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `${write.id}'s row is gone`,
          ).toBe(null)
          expect(write.outcome, `${write.id} waits for its call`).toBe(
            undefined,
          )
          // A check during the call finds no row, and still waits.
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} waits during its call`).toBe(
            undefined,
          )
          channels.state.loseSettlement = true
          release()
          await settle()
          channels.state.loseSettlement = false
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} keeps the server's outcome`).toBe(
            rejectedRun ? `failed` : `completed`,
          )
          reach(
            rejectedRun
              ? `removed-while-running-rejected`
              : `removed-while-running-completed`,
          )
          break
        }
        case `exclusion-retry-across-handover`:
        case `exclusion-retry-excluded-again`: {
          // The next leader excludes a follower's write and its record fails.
          // Its retry stalls on the record while leadership moves on. The
          // tab that leads next accepts the write, and the retry resumes
          // during that send; or it excludes the write too, and the retry
          // resumes after it settled.
          const again = action.type === `exclusion-retry-excluded-again`
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          excluded.add(write.id)
          // Its first cleanup fails before its decision commits.
          storage.failDecisionWrites = 1
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          await settle()
          expect(
            storage.failDecisionWrites,
            `${write.id}'s exclusion decision failed`,
          ).toBe(0)
          storage.holdNextDecision()
          if (again) {
            // The original tab leads next, so the writer stays a follower.
            const writerElection = tabs[writer]!.election
            writerElection.releaseLeadership()
            await writerElection.requestLeadership()
            online.set(true)
            await settle()
            write.excluded = true
            write.deliverable = false
            // The writer misses the rejection and the new leader's message,
            // so it reads the outbox only after the stalled record lands.
            channels.state.loseSettlement = true
            channels.state.loseLeader = true
            next.releaseLeadership()
            await settle()
            storage.releaseDecision()
            await settle()
            channels.state.loseSettlement = false
            channels.state.loseLeader = false
            await next.requestLeadership()
            channels.inject({ type: `leader` })
            await settle()
            expect(write.outcome, `${write.id} fails from a record`).toBe(
              `failed`,
            )
            reach(`fenced-cleanup-kept-rejection`)
            break
          }
          excluded.delete(write.id)
          online.set(true)
          await settle()
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          next.releaseLeadership()
          await settle()
          expect(calls, `${write.id} sent by the next leader`).toContain(
            write.id,
          )
          // The send completes and its message is lost; the writer checks
          // the outbox while the stalled decision is still pending.
          channels.state.loseSettlement = true
          release()
          await settle()
          channels.state.loseSettlement = false
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          storage.releaseDecision()
          await settle()
          await next.requestLeadership()
          await settle()
          expect(write.outcome, `${write.id} stays completed`).toBe(`completed`)
          reach(`fenced-cleanup-yielded`)
          break
        }
        case `removal-across-handover`: {
          // A follower asks to remove a follower's unsent write, the leader
          // never hears it, and the leader closes.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          const remover = action.tab
          if (
            !durable ||
            leader < 0 ||
            !next ||
            writer < 0 ||
            !tabs[remover] ||
            remover === leader ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          channels.state.loseRemoval = true
          let done = false
          const removal = tabs[remover].env.executor.removeFromOutbox(
            write.transactionId!,
          )
          void removal.then(() => {
            done = true
          })
          await settle()
          expect(done, `the leader never heard the removal`).toBe(false)
          const nextLeads = tabs[remover].election === next
          await closeTab(leader)
          await settle()
          expect(done, `the removal finished under the next leader`).toBe(true)
          write.removed = true
          write.deliverable = false
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(
            nextLeads
              ? `removal-made-by-new-leader`
              : `removal-resent-to-new-leader`,
          )
          break
        }
        case `replace-writer`:
        case `replace-rejected-writer`: {
          // A follower's executor is disposed with its write saved; another
          // tab settles the write, then a replacement over the same
          // collection starts.
          const rejectedWrite = action.type === `replace-rejected-writer`
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (!durable || leader < 0 || writer < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(
            writer,
            rejectedWrite ? `write-rejected` : `write`,
          )
          if (!write) break
          const collection = tabs[writer]!.env.collection
          await closeTab(writer)
          online.set(true)
          await settle()
          expect(calls, `${write.id} sent by the leader`).toContain(write.id)
          expect(write.outcome, `${write.id} waits for a replacement`).toBe(
            undefined,
          )
          // The replacement reaches the same outbox through a new adapter.
          await openTab(
            writer,
            undefined,
            undefined,
            false,
            collection,
            new StorageView(storage),
          )
          expect(write.outcome, `${write.id} settled by the replacement`).toBe(
            rejectedWrite ? `failed` : `completed`,
          )
          if (rejectedWrite) {
            expect(write.error, `${write.id} error type`).toBeInstanceOf(
              NonRetriableError,
            )
            expect((write.error as Error).message, `${write.id} error`).toBe(
              `rejected ${write.id}`,
            )
          }
          reach(
            rejectedWrite
              ? `replacement-settled-rejection`
              : `replacement-settled-success`,
          )
          break
        }
        case `replace-writer-other-store`: {
          // A disposed follower's write is unsent; its replacement keeps the
          // collection but uses another store, then gives way to a tab over
          // the shared one.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (!durable || leader < 0 || writer < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          const collection = tabs[writer]!.env.collection
          await closeTab(writer)
          await openTab(
            writer,
            undefined,
            undefined,
            false,
            collection,
            new FakeStorageAdapter(),
          )
          expect(write.outcome, `${write.id} waits for its own outbox`).toBe(
            undefined,
          )
          reach(`replacement-other-store-waited`)
          await closeTab(writer)
          await openTab(writer)
          break
        }
        case `unreadable-saved-row`: {
          // A follower's saved row cannot be decoded while a check runs.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (!durable || leader < 0 || writer < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          const key = `tx:${write.transactionId}`
          const saved = (await storage.get(key))!
          await storage.set(key, `{not json`)
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} waits on its unreadable row`).toBe(
            undefined,
          )
          await storage.set(key, saved)
          reach(`unreadable-row-kept-waiting`)
          break
        }
        case `clear-partially-fails`: {
          // The leader clears two unsent writes and one deletion fails.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          online.set(false)
          const first = await doWrite(follower, `write`)
          const second = await doWrite(follower, `write`)
          if (!first || !second) break
          // The first removal decision fails to persist.
          storage.failDecisionWrites = 1
          await expect(
            tabs[leader]!.env.executor.clearOutbox(),
            `the clear reports its failed removal`,
          ).rejects.toThrow(`storage write failed`)
          storage.failDecisionWrites = 0
          await settle()
          // Which deletion failed is the injected fault's effect.
          let kept = 0
          for (const write of [first, second]) {
            if (await storage.get(`tx:${write.transactionId}`)) {
              kept += 1
              expect(write.outcome, `${write.id} stays pending`).toBe(undefined)
            } else {
              write.removed = true
              write.deliverable = false
              expect(write.outcome, `${write.id} fails when cleared`).toBe(
                `failed`,
              )
            }
          }
          expect(kept, `one row stays`).toBe(1)
          reach(`partial-clear-settled`)
          break
        }
        case `failed-removal-during-save`: {
          // A follower's row lands, the follower asks to remove it, the
          // leader's deletion fails, and the save then acknowledges.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            writer < 0 ||
            !(await quiet())
          )
            break
          storage.holdNextAck()
          const write = await doWrite(writer, `write`)
          if (!write) {
            storage.releaseAck()
            break
          }
          storage.failDecisionWrites = 1
          await expect(
            tabs[writer]!.env.executor.removeFromOutbox(write.transactionId!),
            `the failed removal is reported`,
          ).rejects.toThrow(`storage write failed`)
          storage.failDecisionWrites = 0
          storage.releaseAck()
          await settle()
          expect(calls, `${write.id} still sent`).toContain(write.id)
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`failed-removal-kept-save`)
          break
        }
        case `remove-before-reconnect`: {
          // The leader removes a queued follower write and reconnects while
          // the removal's record is still being written.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(follower, `write`)
          if (!write) break
          storage.holdOutcomeWrite()
          const removal = tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await settle()
          online.set(true)
          await settle()
          expect(calls, `${write.id} not started`).not.toContain(write.id)
          storage.releaseOutcomeWrite()
          await removal
          await settle()
          write.removed = true
          write.deliverable = false
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`removal-held-off-reconnect`)
          break
        }
        case `failed-cleanup-across-terms`: {
          // The next leader excludes a follower's write; its record stalls,
          // it loses leadership to a tab that accepts the write, and the
          // record then fails. It leads again later and accepts the write.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          excluded.add(write.id)
          storage.holdNextDecision()
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          expect(
            storage.decisionHeld(),
            `the exclusion's decision stalls`,
          ).toBe(true)
          await original.requestLeadership()
          excluded.delete(write.id)
          next.releaseLeadership()
          await settle()
          storage.releaseDecision(true)
          await settle()
          await next.requestLeadership()
          await rotateTo(next)
          await new Promise((resolve) => setTimeout(resolve, 1100))
          await settle()
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `${write.id} stays saved`,
          ).not.toBe(null)
          expect(write.outcome, `${write.id} stays pending`).toBe(undefined)
          reach(`stale-cleanup-not-retried`)
          break
        }
        case `exclusion-across-handover-mid-delete`:
        case `exclusion-across-handover-mid-mark`: {
          // The next leader excludes a follower's write and its deletion, or
          // the write of its decision, stalls; leadership moves to a tab
          // that would accept the write.
          const midMark = action.type === `exclusion-across-handover-mid-mark`
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          excluded.add(write.id)
          if (midMark) storage.holdNextDecision()
          else storage.holdNextDelete()
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          excluded.delete(write.id)
          if (midMark) {
            // The next leader sends the unmarked row; the stalled decision
            // then lands and changes nothing.
            let release!: () => void
            callGate = new Promise<void>((resolve) => {
              release = resolve
            })
            online.set(true)
            await settle()
            next.releaseLeadership()
            await settle()
            expect(calls, `${write.id} sent by the next leader`).toContain(
              write.id,
            )
            storage.releaseDecision()
            await settle()
            expect(write.outcome, `${write.id} waits for that send`).toBe(
              undefined,
            )
            release()
            await settle()
            await next.requestLeadership()
            await settle()
            expect(write.outcome, `${write.id} completes`).toBe(`completed`)
            reach(`exclusion-yielded-to-successor`)
            break
          }
          write.excluded = true
          write.deliverable = false
          online.set(true)
          await settle()
          next.releaseLeadership()
          await settle()
          storage.releaseDelete()
          await settle()
          await next.requestLeadership()
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          expect(write.outcome, `${write.id} stays excluded`).toBe(`failed`)
          reach(`exclusion-decision-survived-handover`)
          break
        }
        case `removal-mark-landed-handover`:
        case `removal-mark-held-handover`:
        case `removal-mark-held-late`:
        case `removal-mark-held-offline`: {
          // The leader removes a queued follower write and loses leadership
          // while its removal decision is written: after it landed, or
          // before.
          const landed = action.type === `removal-mark-landed-handover`
          // The stalled decision lands only after the next leader settled
          // the write and its row is gone.
          const late = action.type === `removal-mark-held-late`
          // Offline, the next leader queues the write without sending it.
          const offlineHandover = action.type === `removal-mark-held-offline`
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.holdNextDecision(landed)
          const removal = tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await settle()
          let release = () => {}
          if (!landed && !offlineHandover)
            callGate = new Promise<void>((resolve) => {
              release = resolve
            })
          if (!offlineHandover) online.set(true)
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          if (offlineHandover) {
            // The removal that yielded is made by the next leader.
            storage.releaseDecision()
            await removal
            await settle()
            await original.requestLeadership()
            await settle()
            write.removed = true
            write.deliverable = false
            expect(calls, `${write.id} never sent`).not.toContain(write.id)
            expect(write.outcome, `${write.id} fails on its removal`).toBe(
              `failed`,
            )
            reach(`yielded-removal-forwarded`)
            break
          }
          if (landed) {
            storage.releaseDecision()
            await removal
            await settle()
            await original.requestLeadership()
            await settle()
            write.removed = true
            write.deliverable = false
            expect(calls, `${write.id} never sent`).not.toContain(write.id)
            expect(write.outcome, `${write.id} fails on its removal`).toBe(
              `failed`,
            )
            reach(`removal-decision-survived-handover`)
            break
          }
          expect(calls, `${write.id} sent by the next leader`).toContain(
            write.id,
          )
          if (late) {
            release()
            await settle()
            expect(write.outcome, `${write.id} completes`).toBe(`completed`)
            storage.releaseDecision()
            await removal
            await settle()
            await original.requestLeadership()
            // A later replay finds nothing to settle.
            await rotateTo(original)
            expect(
              await storage.get(`tx:${write.transactionId}`),
              `${write.id} stays removed`,
            ).toBe(null)
            expect(
              (await storage.keys()).filter((key) =>
                key.startsWith(
                  `decision:${encodeURIComponent(write.transactionId!)}:`,
                ),
              ),
              `the stale decision is gone`,
            ).toEqual([])
            expect(write.outcome, `${write.id} stays completed`).toBe(
              `completed`,
            )
            reach(`stale-decision-left-no-row`)
            break
          }
          storage.releaseDecision()
          await removal
          await settle()
          expect(write.outcome, `${write.id} waits for that send`).toBe(
            undefined,
          )
          release()
          await settle()
          await original.requestLeadership()
          await settle()
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`removal-yielded-to-successor`)
          break
        }
        case `forwarded-removal-yields`: {
          // A follower behind the next leader asks to remove its queued
          // write; the leader's decision stalls while leadership moves on.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.holdNextDecision()
          let done = false
          void tabs[writer]!.env.executor.removeFromOutbox(
            write.transactionId!,
          ).then(() => {
            done = true
          })
          await settle()
          expect(storage.decisionHeld(), `the leader's decision stalls`).toBe(
            true,
          )
          expect(done, `the removal waits for that decision`).toBe(false)
          expect(write.outcome, `${write.id} still pending`).toBe(undefined)
          // The follower misses the next leader's message, so only the reply
          // to its request can send it there.
          channels.state.loseLeader = true
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          channels.state.loseLeader = false
          storage.releaseDecision()
          await settle()
          await original.requestLeadership()
          await settle()
          expect(done, `the removal finished under the next leader`).toBe(true)
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `${write.id} removed`,
          ).toBe(null)
          write.removed = true
          write.deliverable = false
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`follower-removal-asked-again`)
          break
        }
        case `added-during-committed-removal`: {
          // The leader removes a queued follower write; while its deletion
          // stalls, a duplicate added message arrives online.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(follower, `write`)
          if (!write) break
          storage.holdNextDelete()
          const removal = tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await settle()
          online.set(true)
          await settle()
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          expect(calls, `${write.id} not admitted`).not.toContain(write.id)
          storage.releaseDelete()
          await removal
          await settle()
          write.removed = true
          write.deliverable = false
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`committed-removal-not-admitted`)
          break
        }
        case `adopted-decision-second-handover`: {
          // The leader's removal decision lands but its acknowledgment
          // stalls. The next leader adopts it and its deletion stalls. The
          // first leader then withdraws its own, and leadership moves again.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && tab.election !== next,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.holdNextDecision(true)
          storage.holdNextDelete()
          const removal = tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await settle()
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          await settle()
          // The first leader's request to the next one is lost.
          channels.state.loseRemoval = true
          storage.releaseDecision()
          await settle()
          channels.state.loseRemoval = false
          online.set(true)
          next.releaseLeadership()
          await settle()
          storage.releaseDelete()
          await settle()
          await next.requestLeadership()
          await removal
          await settle()
          write.removed = true
          write.deliverable = false
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`adopted-decision-survived`)
          break
        }
        case `replaced-twice-during-call`:
        case `replaced-twice-extended`: {
          // Each replacement may also add a Collection of its own.
          const extended = action.type === `replaced-twice-extended`
          // A follower's executor is replaced; the replacement leads and
          // issues the write's rejected call; the row is removed and that
          // replacement is replaced in turn while the call runs.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write-rejected`)
          if (!write) break
          const collection = tabs[writer]!.env.collection
          await closeTab(writer)
          await openTab(
            writer,
            undefined,
            undefined,
            false,
            collection,
            storage,
            durable,
            extended ? { zfirst: extraCollection(`first-extra`) } : undefined,
          )
          await rotateTo(tabs[writer]!.election)
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          online.set(true)
          await settle()
          if (!calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          await tabs[writer]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await closeTab(writer)
          await openTab(
            writer,
            undefined,
            undefined,
            false,
            collection,
            storage,
            durable,
            extended ? { zsecond: extraCollection(`second-extra`) } : undefined,
          )
          expect(write.outcome, `${write.id} waits for its issued call`).toBe(
            undefined,
          )
          release()
          await settle()
          expect(write.outcome, `${write.id} takes the server's outcome`).toBe(
            `failed`,
          )
          reach(
            extended
              ? `issued-call-across-extended-replacements`
              : `issued-call-across-replacements`,
          )
          // A tab over more Collections names its own channel; a tab over
          // the shared one takes its place.
          if (extended) {
            await closeTab(writer)
            await openTab(writer)
          }
          break
        }
        case `running-removal-completes-first`: {
          // The leader removes a follower's running write; the call finishes
          // before the removal's deletion acknowledges, and its message is
          // lost.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(follower, `write`)
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          storage.holdNextDelete()
          let removed = false
          const removal = tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          ).then(() => {
            removed = true
          })
          await settle()
          expect(storage.deleteHeld(), `${write.id}'s deletion stalls`).toBe(
            true,
          )
          expect(removed, `the removal waits for its deletion`).toBe(false)
          expect(
            (await outcomesOf(write.transactionId!)).some(
              ({ pending }) => pending,
            ),
            `${write.id} has a running marker`,
          ).toBe(true)
          channels.state.loseSettlement = true
          release()
          await settle()
          channels.state.loseSettlement = false
          expect(
            channels.state.lostIds,
            `${write.id}'s settlement was lost`,
          ).toContain(write.transactionId)
          storage.releaseDelete()
          await removal
          await settle()
          expect(
            await outcomesOf(write.transactionId!),
            `${write.id}'s marker is gone`,
          ).toEqual([])
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`running-marker-retired`)
          break
        }
        case `decision-row-undecodable`: {
          // A committed removal's deletion fails; the next leader cannot
          // decode the row, and the leader after it can.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.failDeletes = 1
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          write.removed = true
          write.deliverable = false
          const key = `tx:${write.transactionId}`
          const saved = await storage.get(key)
          if (saved === null) break
          await storage.set(key, `{not json`)
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          await storage.set(key, saved)
          const second = election.holder!
          second.releaseLeadership()
          await settle()
          await second.requestLeadership()
          online.set(true)
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`decision-kept-for-unreadable-row`)
          break
        }
        case `added-during-replay`: {
          // A committed removal's deletion fails; the next leader's replay
          // stalls while an added message for the row arrives online.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.failDeletes = 1
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          write.removed = true
          write.deliverable = false
          storage.holdNextRead()
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          online.set(true)
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          expect(calls, `${write.id} not admitted`).not.toContain(write.id)
          storage.releaseRead()
          await settle()
          await original.requestLeadership()
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          reach(`admission-waited-for-replay`)
          break
        }
        case `removal-pending-replay-lost`: {
          // The next leader-to-be asks to remove a follower's write and the
          // request is lost. Its replay stalls when it leads, it loses
          // leadership, and the tab after it sends the write.
          const leader = leaderIndex()
          const next = election.queue[0]
          const remover = tabs.findIndex((tab) => tab?.election === next)
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && index !== remover,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            remover < 0 ||
            writer < 0 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          channels.state.loseRemoval = true
          let done = false
          void tabs[remover]!.env.executor.removeFromOutbox(
            write.transactionId!,
          ).then(() => {
            done = true
          })
          await settle()
          channels.state.loseRemoval = false
          storage.holdNextRead()
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          online.set(true)
          // The remover misses the next leader's message, so only its own
          // replay's continuation can act on the request.
          channels.state.loseLeader = true
          next.releaseLeadership()
          await settle()
          channels.state.loseLeader = false
          expect(calls, `${write.id} sent by the tab after`).toContain(write.id)
          storage.releaseRead()
          await settle()
          expect(write.outcome, `${write.id} waits for that send`).toBe(
            undefined,
          )
          release()
          await settle()
          await next.requestLeadership()
          await settle()
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          expect(done, `the removal finished`).toBe(true)
          reach(`pending-removal-left-to-leader`)
          break
        }
        case `default-removal-delete-fails`: {
          // In the default mode the leader removes its own queued write and
          // the deletion fails.
          const leader = leaderIndex()
          if (durable || leader < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(leader, `write`)
          if (!write) break
          storage.failDeletes = 1
          await expect(
            tabs[leader]!.env.executor.removeFromOutbox(write.transactionId!),
            `the failed removal is reported`,
          ).rejects.toThrow(`storage delete failed`)
          expect(write.outcome, `${write.id} still pending`).toBe(undefined)
          online.set(true)
          await settle()
          expect(calls, `${write.id} still sent`).toContain(write.id)
          reach(`default-removal-failure-reported`)
          break
        }
        case `unreadable-orphan-decision`: {
          // A decision with no row cannot be read; a follower's write is
          // queued, and another tab leads and replays.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          await storage.set(`decision:orphan:unread`, `{not json`)
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          online.set(true)
          await settle()
          expect(calls, `${write.id} sent after the replay`).toContain(write.id)
          expect(
            await storage.get(`decision:orphan:unread`),
            `the orphan decision is gone`,
          ).toBe(null)
          reach(`orphan-decision-ignored`)
          break
        }
        case `added-after-failed-replay`: {
          // A committed removal's deletion fails; the next leader's replay
          // fails to read the row, and an added message for it arrives.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.failDeletes = 1
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          write.removed = true
          write.deliverable = false
          storage.failReadKey = `tx:${write.transactionId}`
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          const failed = election.holder!
          expectedWarnings.admission += 1
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          expect(calls, `${write.id} not admitted`).not.toContain(write.id)
          // Connectivity runs the failed replay again before the admission.
          online.set(true)
          await settle()
          expect(calls, `${write.id} still not sent`).not.toContain(write.id)
          // Another leader's replay settles the row.
          failed.releaseLeadership()
          await settle()
          await failed.requestLeadership()
          await original.requestLeadership()
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          reach(`admission-refused-after-failed-replay`)
          break
        }
        case `added-across-replays`: {
          // A committed removal's deletion fails. The next leader's replay
          // stalls while an added message waits on it; that tab loses and
          // regains leadership, and its newer replay stalls too.
          const leader = leaderIndex()
          const next = election.queue[0]
          const nextTab = tabs.findIndex((tab) => tab?.election === next)
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && index !== nextTab,
          )
          if (
            !durable ||
            leader < 0 ||
            nextTab < 0 ||
            writer < 0 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.failDeletes = 1
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          write.removed = true
          write.deliverable = false
          const view = tabs[nextTab]!.view
          view.holdNextRead()
          // The first leader steps out of the election meanwhile.
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          online.set(true)
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          // The tab in between adopts the decision; its deletion stalls.
          storage.holdNextDelete()
          next!.releaseLeadership()
          await settle()
          view.holdNextRead()
          await next!.requestLeadership()
          tabs[writer]!.election.releaseLeadership()
          await settle()
          await tabs[writer]!.election.requestLeadership()
          expect(election.holder, `the stalled tab leads again`).toBe(next)
          view.releaseRead()
          await settle()
          expect(calls, `${write.id} not admitted`).not.toContain(write.id)
          view.releaseRead()
          await settle()
          storage.releaseDelete()
          await settle()
          await original.requestLeadership()
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          reach(`admission-waited-for-newer-replay`)
          break
        }
        case `replay-fails-then-reconnects`: {
          // The next leader's replay fails to read a follower's saved write,
          // an added message for it is refused, and connectivity returns
          // while the same tab leads.
          const leader = leaderIndex()
          const next = election.queue[0]
          const nextTab = tabs.findIndex((tab) => tab?.election === next)
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && index !== nextTab,
          )
          if (
            !durable ||
            leader < 0 ||
            nextTab < 0 ||
            writer < 0 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          storage.failReadKey = `tx:${write.transactionId}`
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          expect(storage.failReadKey, `the replay read failed`).toBe(undefined)
          // The new leader has not read the write, so it does not show it.
          write.unadmittedBy = tabs[nextTab]!.session
          expectedWarnings.admission += 1
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          expect(calls, `${write.id} refused before a replay`).not.toContain(
            write.id,
          )
          online.set(true)
          await settle()
          write.unadmittedBy = undefined
          expect(election.holder, `the same tab leads`).toBe(next)
          expect(calls, `${write.id} sent after reconnecting`).toContain(
            write.id,
          )
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`replay-retried-on-connectivity`)
          await original.requestLeadership()
          await settle()
          break
        }
        case `stale-replay-across-terms`: {
          // The next leader's replay stalls on an exclusion's decision; that
          // tab loses and regains leadership, and its newer replay finishes
          // first. The stalled replay then finishes, and a follower writes.
          const leader = leaderIndex()
          const next = election.queue[0]
          const nextTab = tabs.findIndex((tab) => tab?.election === next)
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && index !== nextTab,
          )
          if (
            !durable ||
            leader < 0 ||
            nextTab < 0 ||
            writer < 0 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          excluded.add(write.id)
          write.excluded = true
          write.deliverable = false
          storage.holdNextDecision()
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          expect(
            storage.decisionHeld(),
            `the exclusion's decision stalls`,
          ).toBe(true)
          await original.requestLeadership()
          // Leadership goes round to the stalled tab again; a tab in between
          // settles the exclusion.
          await rotateTo(next!)
          expect(write.outcome, `${write.id} excluded`).toBe(`failed`)
          online.set(true)
          await settle()
          storage.releaseDecision()
          await settle()
          const later = await doWrite(writer, `write`)
          expect(calls, `${later?.id} sent in the newer term`).toContain(
            later?.id,
          )
          reach(`stale-replay-kept-newer-term`)
          break
        }
        case `overlapping-running-removals`: {
          // The leader removes a follower's running write twice. The first
          // removal's deletion stalls, the call succeeds, and its message is
          // lost.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(follower, `write`)
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          const executor = tabs[leader]!.env.executor
          storage.holdNextDelete()
          const first = executor.removeFromOutbox(write.transactionId!)
          await settle()
          expect(storage.deleteHeld(), `the first deletion stalls`).toBe(true)
          await executor.removeFromOutbox(write.transactionId!)
          expect(
            (await outcomesOf(write.transactionId!)).filter(
              ({ pending }) => pending,
            ),
            `${write.id} has a marker per removal`,
          ).toHaveLength(2)
          channels.state.loseSettlement = true
          release()
          await settle()
          channels.state.loseSettlement = false
          storage.releaseDelete()
          await first
          await settle()
          expect(
            await outcomesOf(write.transactionId!),
            `${write.id}'s markers are gone`,
          ).toEqual([])
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`overlapping-markers-retired`)
          break
        }
        case `rejection-after-outcome-listing`: {
          // The leader removes a follower's running write that the server
          // rejects. The writer lists the outcome records; the rejection then
          // lands, the running marker goes, and the writer reads its listing.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(follower, `write-rejected`)
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          const view = tabs[follower]!.view
          view.holdNextKeys()
          channels.inject({ type: `leader` })
          await settle()
          expect(view.keysHeld(), `the writer listed the records`).toBe(true)
          channels.state.loseSettlement = true
          release()
          await settle()
          channels.state.loseSettlement = false
          view.releaseKeys()
          await settle()
          expect(write.outcome, `${write.id} takes the rejection`).toBe(
            `failed`,
          )
          reach(`rejection-recorded-after-listing`)
          break
        }
        case `unreadable-outcome-before-rejection`: {
          // An unreadable outcome record precedes the rejection of a
          // follower's write, whose settlement message is lost.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(follower, `write-rejected`)
          if (!write) break
          await storage.set(
            `outcome:${encodeURIComponent(write.transactionId!)}:0`,
            `{not json`,
          )
          channels.state.loseSettlement = true
          online.set(true)
          await settle()
          channels.state.loseSettlement = false
          expect(calls, `${write.id} sent`).toContain(write.id)
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} takes the rejection`).toBe(
            `failed`,
          )
          reach(`rejection-read-past-unreadable-record`)
          break
        }
        case `decision-without-error`: {
          // A follower's saved write has a decision that holds no error, and
          // another tab leads and replays.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (!durable || leader < 0 || writer < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          await storage.set(
            `decision:${encodeURIComponent(write.transactionId!)}:empty`,
            `{}`,
          )
          write.deliverable = false
          write.failure = `Transaction rejected by a recorded decision`
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          online.set(true)
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          expect(write.outcome, `${write.id} settled as decided`).toBe(`failed`)
          reach(`decision-without-error-settled`)
          break
        }
        case `remove-running-retryable`: {
          // The leader removes a follower's running write; the call then
          // fails with a retryable error, and its message is lost.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(follower, `write`)
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          retryable.add(write.id)
          write.rejected = true
          write.failure = `retry ${write.id}`
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          channels.state.loseSettlement = true
          release()
          await settle()
          channels.state.loseSettlement = false
          channels.inject({ type: `leader` })
          await settle()
          expect(write.outcome, `${write.id} takes the call's error`).toBe(
            `failed`,
          )
          reach(`removed-retryable-failure-recorded`)
          break
        }
        case `added-during-unsent-removal`: {
          // The leader removes a queued follower write; while its decision
          // is still being recorded, a duplicate added message arrives
          // online.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(follower, `write`)
          if (!write) break
          storage.holdNextDecision()
          const removal = tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await settle()
          expect(storage.decisionHeld(), `the removal's decision stalls`).toBe(
            true,
          )
          online.set(true)
          await settle()
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          expect(calls, `${write.id} not admitted`).not.toContain(write.id)
          storage.releaseDecision()
          await removal
          await settle()
          write.removed = true
          write.deliverable = false
          expect(write.outcome, `${write.id} fails on its removal`).toBe(
            `failed`,
          )
          reach(`unsent-removal-not-admitted`)
          break
        }
        case `remove-running-record-fails-handover`: {
          // The leader removes a follower's running write, whose call then
          // fails with a retryable error. Recording that error fails once,
          // and the leader stops leading before it records it again.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            election.queue.length === 0 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(follower, `write`)
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          retryable.add(write.id)
          write.rejected = true
          write.failure = `retry ${write.id}`
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          storage.failOutcomeWrites = 1
          release()
          await settle()
          expect(
            storage.outcomeFailed(write.transactionId!),
            `${write.id}'s record failed`,
          ).toBe(true)
          expect(write.outcome, `${write.id} waits for its record`).toBe(
            undefined,
          )
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          online.set(true)
          await settle()
          expect(
            storage.recordedRejections.has(write.transactionId!),
            `${write.id}'s error recorded`,
          ).toBe(true)
          expect(write.outcome, `${write.id} takes the call's error`).toBe(
            `failed`,
          )
          reach(`removed-outcome-survived-handover`)
          await original.requestLeadership()
          await settle()
          break
        }
        case `connectivity-during-failing-check`: {
          // A follower's settlement is lost. Its outbox check fails to read
          // that write, then waits for another save of the same tab, and
          // connectivity changes meanwhile.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          channels.state.loseSettlement = true
          const lost = await doWrite(follower, `write`)
          channels.state.loseSettlement = false
          if (
            !lost ||
            !channels.state.lostIds.includes(lost.transactionId!) ||
            lost.outcome !== undefined
          )
            break
          storage.holdWrites()
          await doWrite(follower, `write`)
          storage.failReadKey = `tx:${lost.transactionId}`
          expectedWarnings.check += 1
          channels.inject({ type: `leader` })
          await settle()
          expect(storage.failReadKey, `the check's read failed`).toBe(undefined)
          online.set(true)
          await settle()
          storage.releaseWrites(false)
          await settle()
          expect(lost.outcome, `${lost.id} settled after reconnecting`).toBe(
            `completed`,
          )
          reach(`check-retried-after-running-sweep`)
          break
        }
        case `remove-phase-read-fails`: {
          // The leader sends a follower's write and fails to delete its row.
          // Offline, the next leader loads that row; its removal finds the
          // row, then fails to read its phase.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            !(await quiet())
          )
            break
          storage.failDeletes = 1
          const write = await doWrite(follower, `write`)
          if (!write || !calls.includes(write.id)) {
            storage.failDeletes = 0
            break
          }
          online.set(false)
          const successor = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          await rotateTo(tabs[successor]!.election)
          storage.failReadKey = `tx:${write.transactionId}`
          storage.failReadKeyAfter = 1
          await expect(
            tabs[successor]!.env.executor.removeFromOutbox(
              write.transactionId!,
            ),
            `the removal reports the failed read`,
          ).rejects.toThrow(`storage read failed`)
          await settle()
          expect(storage.failReadKey, `the phase read failed`).toBe(undefined)
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `${write.id}'s row kept`,
          ).not.toBe(null)
          expect(write.outcome, `${write.id} still waits`).toBe(undefined)
          online.set(true)
          await settle()
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`phase-read-failure-kept-row`)
          await closeTab(leader)
          break
        }
        case `readable-decision-before-unreadable`: {
          // A follower's saved write has a removal decision and, after it,
          // an unreadable one; another tab leads and replays.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (!durable || leader < 0 || writer < 0 || !(await quiet())) break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          const prefix = `decision:${encodeURIComponent(write.transactionId!)}`
          await storage.set(
            `${prefix}:a`,
            JSON.stringify({
              error: {
                name: `NonRetriableError`,
                message: `Transaction removed from the outbox`,
              },
              at: Date.now(),
            }),
          )
          await storage.set(`${prefix}:b`, `{not json`)
          write.deliverable = false
          write.removed = true
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          online.set(true)
          await settle()
          expect(calls, `${write.id} never sent`).not.toContain(write.id)
          expect(write.outcome, `${write.id} settled as decided`).toBe(`failed`)
          expect(
            (write.error as Error).message,
            `${write.id} keeps the readable error`,
          ).toBe(`Transaction removed from the outbox`)
          reach(`readable-decision-kept`)
          break
        }
        case `remove-deletion-pending`: {
          // The leader sends a follower's write and fails to delete its row.
          // Offline, the next leader loads that row, and it is removed.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            follower < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          storage.failDeletes = 1
          const write = await doWrite(follower, `write`)
          if (!write || !calls.includes(write.id)) {
            storage.failDeletes = 0
            break
          }
          online.set(false)
          const successor = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          await rotateTo(tabs[successor]!.election)
          await tabs[successor]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          await settle()
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `${write.id} removed`,
          ).toBe(null)
          expect(write.outcome, `${write.id} completes`).toBe(`completed`)
          reach(`removed-after-success-completed`)
          await closeTab(leader)
          break
        }
        case `remove-own-running`:
        case `remove-own-rejected-running`: {
          // The leader removes its own write while its call runs, then loses
          // leadership; the next leader's check runs during the call.
          const rejectedRun = action.type === `remove-own-rejected-running`
          const leader = leaderIndex()
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          let release!: () => void
          callGate = new Promise<void>((resolve) => {
            release = resolve
          })
          const write = await doWrite(
            leader,
            rejectedRun ? `write-rejected` : `write`,
          )
          if (!write || !calls.includes(write.id)) {
            callGate = null
            release()
            await settle()
            break
          }
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          await settle()
          expect(write.outcome, `${write.id} waits during its call`).toBe(
            undefined,
          )
          release()
          await settle()
          expect(write.outcome, `${write.id} keeps the server's outcome`).toBe(
            rejectedRun ? `failed` : `completed`,
          )
          reach(
            rejectedRun
              ? `own-running-removal-rejected`
              : `own-running-removal-completed`,
          )
          break
        }
        case `replace-default-with-durable`: {
          // In the default mode the leader saves its own write offline,
          // another leader rejects it, and a durable executor replaces the
          // writer over the same collection.
          const leader = leaderIndex()
          if (
            durable ||
            leader < 0 ||
            tabs.filter(Boolean).length < 2 ||
            !(await quiet())
          )
            break
          online.set(false)
          const write = await doWrite(leader, `write-rejected`)
          if (!write) break
          const original = tabs[leader]!.election
          original.releaseLeadership()
          await settle()
          await original.requestLeadership()
          online.set(true)
          await settle()
          expect(calls, `${write.id} sent by another leader`).toContain(
            write.id,
          )
          const collection = tabs[leader]!.env.collection
          await closeTab(leader)
          await openTab(
            leader,
            undefined,
            undefined,
            false,
            collection,
            storage,
            true,
          )
          // No record tells a rejection from a success.
          expect(write.outcome, `${write.id} stays pending`).toBe(undefined)
          reach(`default-predecessor-unresolved`)
          await closeTab(leader)
          await openTab(leader)
          break
        }
        case `clear-across-handover`: {
          // The next leader-to-be asks to clear the outbox, the leader never
          // hears it, another write lands, and the leader closes.
          const leader = leaderIndex()
          const next = election.queue[0]
          const remover = action.tab
          const writer = tabs.findIndex(
            (tab, index) => tab && index !== leader && index !== remover,
          )
          if (
            !durable ||
            leader < 0 ||
            !next ||
            !tabs[remover] ||
            tabs[remover].election !== next ||
            writer < 0 ||
            !(await quiet())
          )
            break
          online.set(false)
          const cleared = await doWrite(writer, `write`)
          if (!cleared) break
          channels.state.loseRemoval = true
          let done = false
          void tabs[remover].env.executor.clearOutbox().then(() => {
            done = true
          })
          await settle()
          const later = await doWrite(writer, `write`)
          if (!later) break
          await closeTab(leader)
          await settle()
          expect(done, `the clear finished under the next leader`).toBe(true)
          cleared.removed = true
          cleared.deliverable = false
          expect(cleared.outcome, `${cleared.id} fails when cleared`).toBe(
            `failed`,
          )
          expect(later.outcome, `${later.id} stays queued`).toBe(undefined)
          // The new leader still sends it once online.
          online.set(true)
          await settle()
          expect(calls, `${later.id} sent by the new leader`).toContain(
            later.id,
          )
          reach(`clear-kept-later-write`)
          break
        }
        case `fail-outbox-check`: {
          const sessionsOpen = openSessions()
          const pending = writes.filter(
            (write) =>
              write.outcome === undefined &&
              write.deliverable &&
              !write.preInit &&
              sessionsOpen.has(write.session),
          )
          if (!durable || pending.length === 0) break
          // The read that fails is this writer's check of its own row.
          const target =
            pending.find(
              (write) =>
                write.transactionId &&
                channels.state.lostIds.includes(write.transactionId),
            ) ?? pending[0]!
          if (channels.state.lostIds.includes(target.transactionId!))
            target.checkFailed = true
          reach(`outbox-check-read-failed`)
          storage.failReadKey = `tx:${target.transactionId}`
          expectedWarnings.check += 1
          channels.inject({ type: `leader` })
          await settle()
          break
        }
      }
      check(`step ${step} ${action.type}`)
    }

    // End online with a leader. A lost settlement is recovered for its own
    // write: by the writer itself if it became leader, or else after one
    // handover to another tab.
    channels.state.loseSettlement = false
    // Writes whose settlement was lost and whose open tab still waits; only
    // their settlement afterwards is a recovery.
    const waitingAfterLoss = writes.filter(
      (write) =>
        write.transactionId !== undefined &&
        channels.state.lostIds.includes(write.transactionId) &&
        openSessions().has(write.session) &&
        write.outcome === undefined,
    )
    const recovered = () =>
      waitingAfterLoss.some(
        (write) =>
          openSessions().has(write.session) &&
          write.outcome ===
            (write.rejected || !write.deliverable ? `failed` : `completed`),
      )
    online.set(true)
    await settle()
    // The writer whose check failed settles on connectivity, before any
    // handover.
    for (const write of writes) {
      if (!write.checkFailed || !openSessions().has(write.session)) continue
      expect(
        write.outcome,
        `${write.id} settled after its failed check`,
      ).not.toBe(undefined)
      reach(`reconcile-retried`)
    }
    const lostWrites = writes.filter(
      (write) =>
        write.transactionId !== undefined &&
        channels.state.lostIds.includes(write.transactionId),
    )
    if (lostWrites.length > 0) {
      const holder = leaderIndex()
      const leaderSession = tabs[holder]?.session
      for (const write of lostWrites) {
        if (write.session === leaderSession) {
          expect(write.outcome, `${write.id} recovered by its leader`).not.toBe(
            undefined,
          )
        }
      }
      const stranded = lostWrites.filter(
        (write) =>
          write.session !== leaderSession &&
          openSessions().has(write.session) &&
          write.outcome === undefined,
      )
      if (stranded.length > 0 && holder >= 0) {
        await closeTab(holder)
        const nextLeader = tabs[leaderIndex()]?.session
        if (
          stranded.some(
            (write) =>
              write.session !== nextLeader && write.outcome !== undefined,
          )
        ) {
          reach(`lost-settlement-recovered-by-follower`)
        }
      }
      if (recovered()) reach(`lost-settlement-recovered`)
      if (
        lostWrites.some(
          (write) =>
            write.rejected &&
            openSessions().has(write.session) &&
            write.outcome === `failed`,
        )
      ) {
        reach(`lost-rejection-recovered`)
      }
    }
    if (tabs.every((tab) => !tab)) await openTab(0)
    if (leaderIndex() < 0) await openTab(tabs.findIndex((tab) => !tab))
    online.set(true)
    for (let round = 0; round < 8; round++) await settle()

    const sessionsOpen = openSessions()
    if (
      writes.some(
        (write) =>
          durable &&
          write.rejected &&
          write.deliverable &&
          write.outcome === undefined,
      )
    )
      reach(`orphan-rejection-kept`)
    for (const write of writes) {
      if (!durable || !write.fromFollower) continue
      if (!write.rejected) reach(`follower-write-delivered`)
      else if (sessionsOpen.has(write.session)) {
        reach(`follower-write-rejected`)
      }
    }
    if (writes.some((write) => write.retried && calls.includes(write.id)))
      reach(`admission-retried`)
    for (const send of sends) {
      const write = writes.find((candidate) => candidate.id === send.id)!
      if (write.preInit || (!durable && write.fromFollower)) {
        // The online path: the writing tab calls the server itself.
        expect(send.sender, `${send.id} sent by its own tab`).toBe(
          write.session,
        )
      } else {
        // A durable write is sent only by the tab that leads at that moment.
        expect(send.sender, `${send.id} sent by the leader`).toBe(send.leader)
      }
    }
    expect([...calls].sort(), `each write reached the server once`).toEqual(
      writes
        .filter((write) => write.deliverable)
        .map((write) => write.id)
        .sort(),
    )
    const executor = tabs[leaderIndex()]!.env.executor
    expect(await executor.peekOutbox(), `the outbox is empty`).toEqual([])
    // A rejection record stays only for a rejected durable write whose tab
    // closed before it settled; a completed write leaves no record.
    const outcomes = (await storage.keys())
      .filter((key) => key.startsWith(`outcome:`))
      .map((key) => decodeURIComponent(key.split(`:`)[1]!))
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .sort()
    const orphans = writes.filter(
      (write) =>
        durable &&
        !write.preInit &&
        (write.excluded ||
          write.removed ||
          (write.deliverable && write.rejected)) &&
        write.outcome === undefined,
    )
    expect(outcomes, `outcome records`).toEqual(
      orphans.map((write) => write.transactionId).sort(),
    )
    // Each kept record holds the rejection its writer will read; a running
    // marker alone would leave that writer waiting.
    for (const write of orphans) {
      const errors = (await outcomesOf(write.transactionId!)).map(
        ({ error }) => error,
      )
      expect(errors, `${write.id} kept rejection`).toContainEqual({
        name: `NonRetriableError`,
        message: write.removed
          ? `Transaction removed from the outbox`
          : write.excluded
            ? `Transaction excluded by beforeRetry`
            : `rejected ${write.id}`,
      })
    }
    for (const write of writes) {
      if (!sessionsOpen.has(write.session)) continue
      if (write.unresolved) {
        expect(write.outcome, `${write.id} stays pending`).toBe(undefined)
        continue
      }
      expect(write.outcome, `${write.id} outcome`).toBe(
        write.rejected || !write.deliverable ? `failed` : `completed`,
      )
      if (write.removed) {
        expect((write.error as Error).message, `${write.id} removal`).toBe(
          `Transaction removed from the outbox`,
        )
      }
      // The record attempt failed, and a later one for the same write landed.
      if (
        write.recordRetried &&
        write.outcome === `failed` &&
        storage.outcomeFailed(write.transactionId!) &&
        storage.recordedRejections.has(write.transactionId!)
      )
        reach(`outcome-record-retried`)
      if (write.excluded) {
        const error = write.error as Error
        expect(error, `${write.id} exclusion error`).toBeInstanceOf(
          NonRetriableError,
        )
        expect(error.message, `${write.id} exclusion message`).toBe(
          `Transaction excluded by beforeRetry`,
        )
      }
      if (write.failure !== undefined) {
        expect((write.error as Error).message, `${write.id} failure`).toBe(
          write.failure,
        )
      } else if (write.rejected && write.deliverable) {
        const error = write.error as Error
        expect(error, `${write.id} error type`).toBeInstanceOf(
          NonRetriableError,
        )
        expect(error.name, `${write.id} error name`).toBe(`NonRetriableError`)
        expect(error.message, `${write.id} error message`).toBe(
          `rejected ${write.id}`,
        )
      }
    }
  } finally {
    for (const tab of tabs) tab?.env.executor.dispose()
    warn.mockRestore()
    consoleError.mockRestore()
    vi.unstubAllGlobals()
  }
}

const write = (tab: number): Action => ({ type: `write`, tab })
const close = (tab: number): Action => ({ type: `close`, tab })
const offline: Action = { type: `offline` }
const loseSettlement: Action = { type: `lose-settlement` }

oracleProperty({
  id: property,
  law: {
    statement: `With followerWrites 'durable', a write from an initialized tab stays pending until the leading tab sends it to the server exactly once while online, whether or not its tab stayed open, and its open tab's transaction settles with the server's outcome, also when the settlement message is lost. A leader that could not read a saved write sends it once connectivity changes, a row it cannot decode is reported, a failed row removal after a successful send is not reported as the outcome, and a follower's failed outbox check runs again on connectivity. An admission read across a change of leadership schedules nothing, and a write excluded by beforeRetry fails its writer even when the message is lost; if its rejection record fails, the leader retries the cleanup and nothing sends it meanwhile. Removing or clearing an unsent write fails its writer at once, a write removed while it is saved never runs, an outbox load from an earlier leadership term schedules nothing, and a tab that only observes a write leaves its writer's record. A follower's removal goes to the leader, which alone knows whether the call started; an exclusion cleanup stops when its leadership ends; and a replacement executor over the same collections settles its predecessor's saved writes against the outbox they were saved to. A removal or exclusion is recorded as a decision beside its row before anything else, so a later leader settles the row as decided rather than send it, a decision that lands late never recreates a row, and a writer reads a rejection only once its decision committed. A row whose call already settled keeps that outcome when removed, and a removal that yields at a handover is made by the next leader. A successor's adopted decision outlives the first recorder withdrawing its own, a committed removal keeps the write out of direct admission, a running marker is withdrawn even when the call finishes before the removal's deletion, and a call issued by an intermediate replacement keeps its write pending. A removed write whose call is running stays pending until the call settles, also when it is the leader's own; a durable replacement does not read a default-mode predecessor's missing record as success; an unreadable saved row keeps its writer waiting, each removal settles by its own deletion, and a cleanup that failed after its term ended is not retried. A failed replay runs again on connectivity before a refused admission, a replay that outlives its term leaves admission to the newer one, every running marker of overlapping removals is withdrawn, a writer reads a rejection recorded after it listed the records, an unreadable record or decision never hides or blocks a rejection, and a removed running write whose call fails retryably fails its writer with that error, also when its first record fails and its leader then stops leading. No admission sends an unsent write while its removal is being decided, a removal that cannot read a row's phase reports that and keeps the row, a failed outbox check that a connectivity change overlapped runs again, and an unreadable decision never replaces a readable decision's error. In the default mode, a write another leader settled stays pending in its former leader, which cannot tell the outcome. Stale and duplicate messages change nothing. A write made before its tab initializes, and the default mode, keep the online path.`,
    authority: `Issue #2464 and the followerWrites option in docs/guides/offline-transactions.md.`,
    limits: `Three tabs over one storage adapter with controlled election, connectivity and BroadcastChannel; up to twelve actions; no real browser contexts; rejection records of writers that never return are kept, and none is ever expired.`,
  },
  owns: [
    `src/OfflineExecutor.ts`,
    `src/OfflineExecutor.ts#OfflineExecutor.handleOutboxMessage`,
    `src/OfflineExecutor.ts#OfflineExecutor.settleRemovedWrites`,
    `src/OfflineExecutor.ts#OfflineExecutor.openOutboxChannel`,
    `src/OfflineExecutor.ts#OfflineExecutor.announceSettled`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.admitTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.admitFollowerWrite`,
    `src/OfflineExecutor.ts#OfflineExecutor.retryAdmissions`,
    `src/OfflineExecutor.ts#OfflineExecutor.settleFollowerWrite`,
    `src/OfflineExecutor.ts#OfflineExecutor.writesToSharedOutbox`,
    `src/outbox/OutboxManager.ts#OutboxManager.getCurrent`,
    `src/outbox/OutboxManager.ts#OutboxManager.recordRejection`,
    `src/outbox/OutboxManager.ts#OutboxManager.getOutcome`,
    `src/outbox/OutboxManager.ts#OutboxManager.removeOutcome`,
    `src/outbox/OutboxManager.ts#OutboxManager.has`,
    `src/outbox/OutboxManager.ts#OutboxManager.ids`,
    `src/OfflineExecutor.ts#OfflineExecutor.ownsWrite`,
    `src/OfflineExecutor.ts#OfflineExecutor.recordsOutcomes`,
    `src/OfflineExecutor.ts#OfflineExecutor.removeSaved`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.cleanUpExcluded`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.retryFailedCleanups`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.recordsFor`,
    `src/outbox/OutboxManager.ts#OutboxManager.withdrawOutcome`,
    `src/OfflineExecutor.ts#OfflineExecutor.removeForFollower`,
    `src/OfflineExecutor.ts#OfflineExecutor.forwardRemoval`,
    `src/OfflineExecutor.ts#OfflineExecutor.relatedExecutors`,
    `src/OfflineExecutor.ts#OfflineExecutor.finishRunningRemoval`,
    `src/OfflineExecutor.ts#OfflineExecutor.callRunning`,
    `src/OfflineExecutor.ts#OfflineExecutor.trackIssued`,
    `src/OfflineExecutor.ts#OfflineExecutor.removeOrForward`,
    `src/outbox/OutboxManager.ts#OutboxManager.recordDecision`,
    `src/outbox/OutboxManager.ts#OutboxManager.removeDecision`,
    `src/outbox/OutboxManager.ts#OutboxManager.removeDecisions`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.fence`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.release`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.publishRemovedOutcome`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.schedulePublishRetry`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.retryPublications`,
    `src/outbox/OutboxManager.ts#OutboxManager.getPhase`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.retryDecided`,
    `src/outbox/OutboxManager.ts#OutboxManager.recordPending`,
    `src/outbox/OutboxManager.ts#OutboxManager.recordOutcome`,
    `src/outbox/OutboxManager.ts#OutboxManager.outcomeKeys`,
    `src/outbox/OutboxManager.ts#OutboxManager.pruneOutcomes`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.loadPendingTransactions`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.replayFailed`,
  ],
  histories: {
    arbitrary: historyArbitrary,
    runs: 30,
    fixedSeeds: [2464],
    states: reachStates,
    constructed: [
      {
        name: `a follower's online write goes through the leader`,
        enters: [`follower-write-delivered`],
        build: (generated: History): History => spliced(generated, [write(1)]),
      },
      {
        name: `a follower writes offline and closes`,
        enters: [`write-outlived-its-tab`, `follower-write-delivered`],
        build: (generated: History): History =>
          spliced(generated, [offline, write(1), close(1)]),
      },
      {
        name: `the leader closes holding a follower's write`,
        enters: [`leader-closed-with-follower-write`],
        build: (generated: History): History =>
          spliced(generated, [offline, write(1), close(0)]),
      },
      {
        name: `the server rejects a follower's write`,
        enters: [`follower-write-rejected`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `write-rejected`, tab: 2 }],
            `durable`,
            true,
          ),
      },
      {
        name: `a lost settlement is recovered at handover`,
        enters: [`lost-settlement-recovered`, `follower-write-delivered`],
        build: (generated: History): History =>
          spliced(generated, [loseSettlement, write(1)], `durable`, true),
      },
      {
        name: `a tab that stays a follower recovers a lost settlement`,
        enters: [`lost-settlement-recovered-by-follower`],
        build: (generated: History): History =>
          spliced(generated, [loseSettlement, write(2)], `durable`, true),
      },
      {
        name: `the default mode keeps the online follower path`,
        enters: [`online-mode-follower-write-failed`],
        build: (generated: History): History =>
          spliced(generated, [offline, write(1)], `online`),
      },
      {
        name: `stale and duplicate messages change nothing`,
        enters: [`stale-message-ignored`, `duplicate-message-ignored`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `stale-added` },
            offline,
            write(1),
            { type: `duplicate-added` },
          ]),
      },
      {
        name: `a leader message arrives during a save`,
        enters: [`leader-message-during-save`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `write-during-leader-message`, tab: 1 }]),
      },
      {
        name: `a follower's save fails`,
        enters: [`follower-save-failed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `write-save-fails`, tab: 1 }]),
      },
      {
        name: `a leader writes in the default mode`,
        enters: [`online-mode-leader-write-delivered`],
        build: (generated: History): History =>
          spliced(generated, [write(0)], `online`, true),
      },
      {
        name: `failed storage reads are reported`,
        enters: [`admission-read-failed`, `outbox-check-read-failed`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `fail-admission-read` },
            offline,
            write(1),
            { type: `fail-outbox-check` },
          ]),
      },
      {
        name: `a leader retries a saved write it could not read`,
        enters: [`admission-read-failed`, `admission-retried`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `fail-admission-read` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a lost rejection still fails its writer`,
        enters: [`lost-settlement-recovered`, `lost-rejection-recovered`],
        build: (generated: History): History =>
          spliced(
            generated,
            [loseSettlement, { type: `write-rejected`, tab: 2 }],
            `durable`,
            true,
          ),
      },
      {
        name: `a stale admission read does not send a write again`,
        enters: [`stale-admission-ignored`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `stale-admission-read` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a failed outbox check runs again on connectivity`,
        enters: [`outbox-check-read-failed`, `reconcile-retried`],
        build: (generated: History): History =>
          spliced(
            generated,
            [loseSettlement, write(2), { type: `fail-outbox-check` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a cleanup fault is not a follower's outcome`,
        enters: [`removal-failure-not-announced`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `fail-removal` }], `durable`, true),
      },
      {
        name: `an unreadable saved row is reported`,
        enters: [`unreadable-write-reported`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `unreadable-added` }]),
      },
      {
        name: `an admission read across a change of leadership is dropped`,
        enters: [`stale-admission-across-terms`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `stale-admission-across-terms` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a rejection whose writer closed keeps its record`,
        enters: [`orphan-rejection-kept`],
        build: (generated: History): History =>
          spliced(
            generated,
            [offline, { type: `write-rejected`, tab: 1 }, close(1)],
            `durable`,
            true,
          ),
      },
      {
        name: `an exclusion in the default mode keeps no record`,
        enters: [],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclude-on-handover` }], `online`, true),
      },
      {
        name: `a lost exclusion still fails its writer`,
        enters: [`exclusion-recovered`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `exclude-on-handover` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a failed rejection record is retried beside other writes`,
        enters: [`outcome-record-retried`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `fail-outcome-record` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a late admission during an exclusion sends nothing`,
        enters: [`excluded-admission-ignored`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclude-on-handover` }]),
      },
      {
        name: `a write removed before it was sent fails its writer`,
        enters: [`removed-unsent-failed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-unsent`, tab: 0 }]),
      },
      {
        name: `a writer that removes its own unsent write fails`,
        enters: [`removed-unsent-failed`, `removal-forwarded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-unsent`, tab: 1 }]),
      },
      {
        name: `a save acknowledged after a handover is admitted by id`,
        enters: [`save-acknowledged-after-handover`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `ack-after-handover` }]),
      },
      {
        name: `a faulted former leader saves for its successor`,
        enters: [`faulted-former-leader-saved`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `fail-removal` }]),
      },
      {
        name: `a failed start releases its channel and leadership`,
        enters: [`failed-start-released`],
        build: (generated: History): History =>
          spliced(generated, [close(2), { type: `open-failing` }]),
      },
      {
        name: `a leader whose outbox load fails releases its listeners`,
        enters: [`failed-start-released`],
        build: (generated: History): History =>
          spliced(generated, [
            close(0),
            close(1),
            close(2),
            { type: `open-failing` },
          ]),
      },
      {
        name: `a save that ends after its tab closed reaches the leader`,
        enters: [`save-announced-after-dispose`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `dispose-during-save` }]),
      },
      {
        name: `a former leader drops queued writes another leader sent`,
        enters: [`stale-admission-across-terms`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `fail-outcome-record` },
            { type: `stale-admission-across-terms` },
          ]),
      },
      {
        name: `a save that finishes after its writer leads is sent`,
        enters: [`save-finished-after-gain`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `save-after-gain` }]),
      },
      {
        name: `an observer leaves the writer's rejection record`,
        enters: [`observer-left-record`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `observe-rejection` }]),
      },
      {
        name: `clearing the outbox fails an unsent write's writer`,
        enters: [`cleared-unsent-failed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `clear-unsent`, tab: 0 }]),
      },
      {
        name: `a follower that clears the outbox fails an unsent write`,
        enters: [`cleared-unsent-failed`, `removal-forwarded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `clear-unsent`, tab: 2 }]),
      },
      {
        name: `a write removed during its save never runs`,
        enters: [`removed-during-save`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-during-save` }]),
      },
      {
        name: `a default-mode write removed during its save never runs`,
        enters: [`removed-during-save`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-during-save` }], `online`),
      },
      {
        name: `a write removed while its call runs keeps the server's outcome`,
        enters: [`removed-while-running-completed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-running`, tab: 0 }]),
      },
      {
        name: `a writer that removes its running write keeps the server's outcome`,
        enters: [`removed-while-running-completed`, `removal-forwarded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-running`, tab: 1 }]),
      },
      {
        name: `a bystander that removes a running write keeps the server's outcome`,
        enters: [`removed-while-running-completed`, `removal-forwarded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-running`, tab: 2 }]),
      },
      {
        name: `an exclusion cleanup after its leadership ended changes nothing`,
        enters: [`fenced-cleanup-yielded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclusion-retry-across-handover` }]),
      },
      {
        name: `a stalled exclusion record keeps the next leader's rejection`,
        enters: [`fenced-cleanup-kept-rejection`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclusion-retry-excluded-again` }]),
      },
      {
        name: `a follower that becomes leader makes its own lost removal`,
        enters: [`removal-made-by-new-leader`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-across-handover`, tab: 1 }]),
      },
      {
        name: `a follower asks the next leader again for a lost removal`,
        enters: [`removal-resent-to-new-leader`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-across-handover`, tab: 2 }]),
      },
      {
        name: `a write removed while its call runs takes the server's rejection`,
        enters: [`removed-while-running-rejected`, `removal-forwarded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-rejected-running`, tab: 2 }]),
      },
      {
        name: `a replacement over another store leaves an unsent write pending`,
        enters: [`replacement-other-store-waited`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `replace-writer-other-store` }]),
      },
      {
        name: `a writer waits while its saved row cannot be decoded`,
        enters: [`unreadable-row-kept-waiting`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `unreadable-saved-row` }]),
      },
      {
        name: `a partly failed clear settles the row it deleted`,
        enters: [`partial-clear-settled`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `clear-partially-fails` }]),
      },
      {
        name: `a clear under the next leader keeps a later write queued`,
        enters: [`clear-kept-later-write`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `clear-across-handover`, tab: 1 }]),
      },
      {
        name: `a failed removal during a save leaves the write to send`,
        enters: [`failed-removal-kept-save`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `failed-removal-during-save` }]),
      },
      {
        name: `a reconnect during a removal does not start the write`,
        enters: [`removal-held-off-reconnect`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-before-reconnect` }]),
      },
      {
        name: `a cleanup that failed after its leadership ended is dropped`,
        enters: [`stale-cleanup-not-retried`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `failed-cleanup-across-terms` }]),
      },
      {
        name: `an exclusion pending deletion at a handover stays an exclusion`,
        enters: [`exclusion-decision-survived-handover`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `exclusion-across-handover-mid-delete` },
          ]),
      },
      {
        name: `an exclusion not yet decided at a handover gives way to the send`,
        enters: [`exclusion-yielded-to-successor`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclusion-across-handover-mid-mark` }]),
      },
      {
        name: `a removal decided before a handover is settled by the next leader`,
        enters: [`removal-decision-survived-handover`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-mark-landed-handover` }]),
      },
      {
        name: `a removal not yet decided at a handover gives way to the send`,
        enters: [`removal-yielded-to-successor`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-mark-held-handover` }]),
      },
      {
        name: `a removal decision landing after the send leaves no row`,
        enters: [`stale-decision-left-no-row`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-mark-held-late` }]),
      },
      {
        name: `a removal that yields at a handover is made by the next leader`,
        enters: [`yielded-removal-forwarded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-mark-held-offline` }]),
      },
      {
        name: `a follower's removal the leader yielded is asked again`,
        enters: [`follower-removal-asked-again`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `forwarded-removal-yields` }]),
      },
      {
        name: `an added message during a committed removal sends nothing`,
        enters: [`committed-removal-not-admitted`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `added-during-committed-removal` }]),
      },
      {
        name: `an adopted decision survives a second handover`,
        enters: [`adopted-decision-survived`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `adopted-decision-second-handover` }]),
      },
      {
        name: `an issued call is tracked across two replacements`,
        enters: [`issued-call-across-replacements`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `replaced-twice-during-call` }]),
      },
      {
        name: `a call finishing before its removal leaves no marker`,
        enters: [`running-marker-retired`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `running-removal-completes-first` }]),
      },
      {
        name: `a decision outlives a leader that cannot decode its row`,
        enters: [`decision-kept-for-unreadable-row`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `decision-row-undecodable` }]),
      },
      {
        name: `an added message during a replay waits for it`,
        enters: [`admission-waited-for-replay`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `added-during-replay` }]),
      },
      {
        name: `a removal stays with the leader after a lost replay`,
        enters: [`pending-removal-left-to-leader`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `removal-pending-replay-lost` }]),
      },
      {
        name: `a default-mode removal reports a failed deletion`,
        enters: [`default-removal-failure-reported`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `default-removal-delete-fails` }],
            `online`,
          ),
      },
      {
        name: `an unreadable orphan decision does not stop a replay`,
        enters: [`orphan-decision-ignored`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `unreadable-orphan-decision` }]),
      },
      {
        name: `an added message after a failed replay is refused`,
        enters: [`admission-refused-after-failed-replay`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `added-after-failed-replay` }]),
      },
      {
        name: `an added message waits for a newer replay`,
        enters: [`admission-waited-for-newer-replay`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `added-across-replays` }]),
      },
      {
        name: `replacements that add Collections still see an issued call`,
        enters: [`issued-call-across-extended-replacements`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `replaced-twice-extended` }]),
      },
      {
        name: `removing a write whose call succeeded completes it`,
        enters: [`removed-after-success-completed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-deletion-pending` }]),
      },
      {
        name: `a leader's own running write removed keeps the server's outcome`,
        enters: [`own-running-removal-completed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-own-running` }]),
      },
      {
        name: `a leader's own running write removed takes the server's rejection`,
        enters: [`own-running-removal-rejected`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-own-rejected-running` }]),
      },
      {
        name: `a durable replacement leaves a default-mode write pending`,
        enters: [`default-predecessor-unresolved`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `replace-default-with-durable` }],
            `online`,
          ),
      },
      {
        name: `a replacement settles its predecessor's completed write`,
        enters: [`replacement-settled-success`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `replace-writer` }]),
      },
      {
        name: `a replacement settles its predecessor's rejected write`,
        enters: [`replacement-settled-rejection`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `replace-rejected-writer` }]),
      },
      {
        name: `an outbox load from an earlier term schedules nothing`,
        enters: [`stale-load-dropped`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `stale-load-across-terms` }]),
      },
      {
        name: `a default-mode write another leader rejected stays pending`,
        enters: [`former-leader-write-unresolved`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `handover-rejection` }], `online`),
      },
      {
        name: `a failed record before an exclusion sends nothing twice`,
        enters: [`exclusion-cleanup-kept`],
        // The benign tail keeps this leader, so the queue retries the failed
        // exclusion cleanup rather than another leader's replay.
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `fail-outcome-record` }, { type: `exclude-on-handover` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a failed replay runs again on connectivity`,
        enters: [`replay-retried-on-connectivity`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `replay-fails-then-reconnects` }]),
      },
      {
        name: `a stale replay leaves the newer term's admission open`,
        enters: [`stale-replay-kept-newer-term`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `stale-replay-across-terms` }]),
      },
      {
        name: `overlapping removals of a running write retire both markers`,
        enters: [`overlapping-markers-retired`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `overlapping-running-removals` }]),
      },
      {
        name: `a rejection recorded after the listing still fails its writer`,
        enters: [`rejection-recorded-after-listing`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `rejection-after-outcome-listing` }]),
      },
      {
        name: `an unreadable outcome record does not hide a rejection`,
        enters: [`rejection-read-past-unreadable-record`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `unreadable-outcome-before-rejection` }]),
      },
      {
        name: `a decision with no error still settles its row`,
        enters: [`decision-without-error-settled`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `decision-without-error` }]),
      },
      {
        name: `a removed running write's retryable failure is recorded`,
        enters: [`removed-retryable-failure-recorded`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-running-retryable` }]),
      },
      {
        name: `an added message during an unsent removal sends nothing`,
        enters: [`unsent-removal-not-admitted`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `added-during-unsent-removal` }]),
      },
      {
        name: `a removed running write's error survives a handover`,
        enters: [`removed-outcome-survived-handover`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `remove-running-record-fails-handover` },
          ]),
      },
      {
        name: `connectivity during a failing outbox check retries it`,
        enters: [`check-retried-after-running-sweep`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `connectivity-during-failing-check` }]),
      },
      {
        name: `a failed phase read keeps a sent row`,
        enters: [`phase-read-failure-kept-row`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-phase-read-fails` }]),
      },
      {
        name: `an unreadable decision keeps a readable one's error`,
        enters: [`readable-decision-kept`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `readable-decision-before-unreadable` }]),
      },
      {
        name: `a write before initialization takes the online path`,
        enters: [`pre-initialization-write`],
        build: (generated: History): History =>
          spliced(generated, [
            close(1),
            { type: `open-and-write`, tab: 1 },
            offline,
            close(2),
            { type: `open-and-write`, tab: 2 },
          ]),
      },
    ],
  },
  resolve: (history: History) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan: { history: History }, observe) =>
    recordAssertionJudgment(property, plan, observe, () =>
      runHistory(plan.history, (state) => observe(`reach`, state)),
    ),
  check: forwardAssertionJudgment,
})
