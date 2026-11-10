import { describe, it } from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import { checkReplayPublication } from '../../db/tests/query/load-subset-retained-publication-oracle.js'
import {
  checkQueuedAnswerProgress,
  createProgressReceiptCheck,
  modelProgressValue,
  queuedAnswerExample,
} from './queued-answer-progress-oracle.js'
import { receiveProgressHistory } from './queued-answer-progress-supervisor.js'
import type { ProgressHistory } from './queued-answer-progress-oracle.js'

/**
 * Finite pre-edit receiving controls reuse the existing law, model, driver and
 * comparison. This ordinary runner defines no new oracle or expected answer.
 * Declared counts are finite-path reach, not generated coverage or universal
 * closure. No environment selector disables a reach check.
 *
 * A strict nonempty replay can reproduce the known bounded progress RED before
 * final publication. A separate scope-key control can finish and test retained
 * and final values without claiming the conflicting subscription-key path did.
 * Each path needs separate root admission; registration authorizes no runtime.
 */
const paths: Array<{
  name: string
  history: ProgressHistory
  states: Array<string>
}> = [
  {
    name: 'nonempty conflicting replay',
    history: { ...queuedAnswerExample, nonemptyPrior: true },
    states: [
      'nonempty-prior', 'held-provider-read', 'conflicting-cache-premise',
      'completed-enqueue', 'answer-executed', 'final-publication', 'worker-cleaned',
    ],
  },
  {
    name: 'nonempty scope-key publication',
    history: { ...queuedAnswerExample, cacheIdentity: 'scope', nonemptyPrior: true },
    states: [
      'nonempty-prior', 'held-provider-read', 'completed-enqueue',
      'answer-executed', 'root-change', 'downstream-change',
      'final-publication', 'worker-cleaned',
    ],
  },
  {
    name: 'literal true initial cut',
    history: { kind: 'sync-initial', keyShift: 0, rankScale: 10 },
    states: [ 'literal-true-establishing-receipt', 'subscriber-return-before-preload', 'final-publication', 'worker-cleaned' ],
  },
  {
    name: 'ordinary synchronous mutation cut',
    history: { kind: 'sync-mutation', keyShift: 0, rankScale: 10 },
    states: [ 'ordinary-mutation-return-before-host-turn', 'final-publication', 'worker-cleaned' ],
  },
]

describe('queued-answer receiving neighbors', () => {
  it.each(paths)('checks receiving neighbor $name', async ({ name, history, states }) => {
    const reach = createOracleReach('query.queued-answer-neighbor/' + name, states, { replaying: false })
    reach.beginHistory()
    const rootCheck = createProgressReceiptCheck(history)
    const downstreamCheck = createProgressReceiptCheck(history)
    const mark = (state: string) => { if (states.includes(state)) reach.reach(state) }
    try {
      const outcome = await receiveProgressHistory(history, (receipt) => {
        rootCheck(receipt)
        if (history.kind === 'query') {
          if (receipt.phase === 'downstream-change') {
            downstreamCheck({ ...receipt, phase: 'public-change' })
            mark('downstream-change')
          } else if (['reload-start', 'cleanup-start'].includes(receipt.phase)) {
            downstreamCheck(receipt)
          } else if (receipt.phase === 'final-publication') {
            downstreamCheck({ ...receipt, rows: receipt.downstream as typeof receipt.rows })
          }
          if (receipt.phase === 'initial-publication' && receipt.rows && receipt.rows.length > 0) mark('nonempty-prior')
          if (receipt.phase === 'retained-publication' && receipt.reason === 'provider-hold-before-release' && typeof receipt.pendingProviderAnswers === 'number' && receipt.pendingProviderAnswers > 0) {
            checkReplayPublication(receipt.downstream, modelProgressValue(history, false), 'held downstream retains the same complete prior snapshot')
            mark('held-provider-read')
          }
          if (receipt.phase === 'public-change') mark('root-change')
          if (receipt.phase === 'conflicting-cache-premise') mark('conflicting-cache-premise')
          if (receipt.phase === 'answer-queued' && receipt.enqueueReturned === true) mark('completed-enqueue')
          if (receipt.phase === 'answer-executed') mark('answer-executed')
        } else {
          if (receipt.phase === 'source-establishing-receipt' && receipt.literalTrue === true) mark('literal-true-establishing-receipt')
          if (receipt.phase === 'immediate-publication' && history.kind === 'sync-initial' && receipt.cut === 'subscriber-return-before-preload') mark('subscriber-return-before-preload')
          if (receipt.phase === 'immediate-publication' && history.kind === 'sync-mutation') mark('ordinary-mutation-return-before-host-turn')
        }
        if (receipt.phase === 'final-publication') mark('final-publication')
        if (receipt.phase === 'worker-cleaned') mark('worker-cleaned')
      })
      checkQueuedAnswerProgress(history, outcome)
      reach.assertReached()
    } finally {
      // Preserve partial reach when a known progress RED precedes later cuts.
      console.info('H02 finite neighbor reach', { name, counts: Object.fromEntries(reach.counts()) })
    }
  }, 60_000)
})
