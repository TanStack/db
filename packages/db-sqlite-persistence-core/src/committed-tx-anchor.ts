// RPC payloads and direct adapter calls can bypass TypeScript's anchor type.
export function isValidCommittedTxAnchor(value: unknown): boolean {
  if (!value || typeof value !== `object`) return false
  const anchor = value as Record<string, unknown>
  return (
    typeof anchor.latestRowVersion === `number` &&
    Number.isSafeInteger(anchor.latestRowVersion) &&
    anchor.latestRowVersion >= 0 &&
    typeof anchor.resetEpoch === `number` &&
    Number.isSafeInteger(anchor.resetEpoch) &&
    anchor.resetEpoch >= 0
  )
}
