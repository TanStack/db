/** Controlled persistence-like handoff: complete proposals wait outside core. */
import { withAcceptedReceipt } from '../../db/src/sync-receipt'
import type { SyncAppliedReceipt, SyncConfig } from '@tanstack/db'
import type { LazyRow } from './lazy-paging-model-oracle'

type Controls = Parameters<SyncConfig<LazyRow>[`sync`]>[0]
type Proposal = {
  apply: () => SyncAppliedReceipt
  accepted: () => void
  visible: () => void
  rejectAccepted: (error: unknown) => void
  rejectVisible: (error: unknown) => void
}

export function deferredLazyAcceptance() {
  let held = false
  const proposals: Array<Proposal> = []
  const accept = (proposal: Proposal) => {
    try {
      const receipt = proposal.apply()
      proposal.accepted()
      if (receipt === true) proposal.visible()
      else void receipt.then(proposal.visible, proposal.rejectVisible)
    } catch (error) {
      proposal.rejectAccepted(error)
      proposal.rejectVisible(error)
    }
  }
  const release = () => {
    held = false
    for (const proposal of proposals.splice(0)) accept(proposal)
  }
  return {
    hold: () => {
      held = true
    },
    release,
    // Keep later proposals deferred while an accepted predecessor's actual
    // core receipt can still be held by an optimistic transaction.
    releaseNext: () => {
      const proposal = proposals.shift()
      if (!proposal) throw new Error(`No deferred Convex proposal to accept.`)
      accept(proposal)
    },
    pending: () => proposals.length,
    wrap: (sync: SyncConfig<LazyRow>): SyncConfig<LazyRow> => ({
      ...sync,
      sync: (controls) => {
        let actions: Array<(target: Controls) => void> = []
        return sync.sync({
          ...controls,
          begin: (options) => {
            actions = [(target) => target.begin(options)]
          },
          write: (message) => {
            actions.push((target) => target.write(message))
          },
          truncate: (options) => {
            actions.push((target) => target.truncate(options))
          },
          commit: (signal) => {
            const batch = actions
            const apply = () => {
              for (const action of batch) action(controls)
              return controls.commit(signal)
            }
            if (!held) return apply()
            let accepted!: () => void
            let rejectAccepted!: (error: unknown) => void
            let visible!: () => void
            let rejectVisible!: (error: unknown) => void
            const acceptance = new Promise<void>((resolve, reject) => {
              accepted = resolve
              rejectAccepted = reject
            })
            const receipt = new Promise<void>((resolve, reject) => {
              visible = resolve
              rejectVisible = reject
            })
            proposals.push({
              apply,
              accepted,
              visible,
              rejectAccepted,
              rejectVisible,
            })
            return withAcceptedReceipt(receipt, acceptance)
          },
        })
      },
    }),
  }
}
