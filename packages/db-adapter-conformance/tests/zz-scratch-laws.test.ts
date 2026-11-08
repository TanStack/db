import { fc } from '@fast-check/vitest'
import { it } from 'vitest'
import { ConformanceViolation, checkEagerLiveSourceHistory, eagerLiveSourceHistoryArb } from '../src'
import { referenceDriver } from './reference-adapter'
import type { ReferenceMutant } from './reference-adapter'

const plain: Array<ReferenceMutant> = [`ready-before-delivery`,`wraps-loading-failure`,`failure-clears-rows`,`transient-is-fatal`,`delivery-error-is-fatal`,`never-recovers`,`transient-fails-loading`,`splits-batch`,`drops-deletes`,`snapshot-merges`,`leaks-subscription`,`restart-replays-rows`,`swallows-prompt-failure`,`ready-at-restart`,`keeps-failed-source`,`double-release`,`detached-rejection`,`logs-failure`,`wait-off-by-one`,`retired-evidence-before-ready`,`forgets-retired-evidence`,`leaks-waits-after-fail`,`wait-ignores-timeout`,`disconnect-fails`,`renew-resubscribes`,`drops-buffered`,`buffer-before-rows`,`replays-per-batch`,`ready-before-buffer`,`shows-buffered`,`merges-updates`,`dates-as-strings`,`bigints-as-numbers`,`drops-nulls`,`loses-negative-zero`,`typed-booleans-as-numbers`,`commits-malformed-prefix`,`ignores-malformed`,`relabels-inserts`]
const outageM: Array<ReferenceMutant> = [`stale-outage-value`,`replaces-outage-value`,`reports-outage-early`,`outage-count-survives-delivery`,`empty-response-keeps-count`,`empty-response-recovers`,`rejected-delivery-fails`,`wraps-loading-failure`]
const outage = { reportAfter: 3, clientValues: true, reportsRejected: true }

async function laws(driver: ReturnType<typeof referenceDriver>) {
  const counts = new Map<string, number>()
  await fc.check(fc.asyncProperty(eagerLiveSourceHistoryArb(driver), async (h) => {
    try { await checkEagerLiveSourceHistory(driver, h) } catch (e) {
      const l = e instanceof ConformanceViolation ? e.law : `outside: ${String(e).slice(0,60)}`
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
  }), { seed: 2118, numRuns: 600 })
  return [...counts].map(([l, n]) => `${l}=${n}`).join(' | ')
}

it('collect', async () => {
  const out: Array<string> = []
  for (const m of plain) out.push(`plain ${m}: ${await laws(referenceDriver(m))}`)
  out.push(`perChange reverses-batch: ${await laws(referenceDriver(`reverses-batch`, { perChange: true }))}`)
  for (const m of outageM) out.push(`outage ${m}: ${await laws(referenceDriver(m, { outage }))}`)
  console.log(out.join('\n'))
}, 3_600_000)
