/**
 * The supervisor retains the semantic receipts that its post-run checker uses.
 * Retain each observation-stage boundary with its callbacks: losing a boundary
 * would judge a lawful later callback against the preceding model stage.
 * Raw receipt capture and realtime observation still receive the whole trace.
 */
export function retainProgressReceipt(receipt: { phase: string }): boolean {
  return [
    `worker-start`,
    `conflicting-cache-premise`,
    `answer-queued`,
    `answer-executed`,
    `reload-start`,
    `followup-start`,
    `followup-publication`,
    `public-change`,
    `downstream-change`,
    `metadata-identities`,
    `cleanup-start`,
    `retained-publication`,
    `initial-publication`,
    `immediate-publication`,
    `final-publication`,
    `source-stack`,
    `worker-error`,
    `worker-cleaned`,
    `source-establishing-receipt`,
  ].includes(receipt.phase)
}
