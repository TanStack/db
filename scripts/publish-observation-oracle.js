// Shared publication judgments, unchanged from the real HTTP receiver.
import assert from 'node:assert/strict'

// Final versions and tags follow the authored initial ledger plus each expected
// successful publication once. This rule does not classify npm's packuments.
export function checkRegistry(state, initial, expected) {
  const final = structuredClone(initial)
  for (const { name, version, tag } of expected) {
    final[name].versions.push(version)
    final[name].tags[tag] = version
  }
  assert.deepEqual(
    state.packages,
    final,
    'HTTP registry retains each version and its promised tag',
  )
}

// Failed attempts are public too: npm forbids publishing an existing exact
// version. Keep every failure, including duplicates that leave the final ledger
// unchanged. Only the driver's single authored fault is allowed.
export function checkHttpUploadFailures(uploads, controlledFailure) {
  const failures = uploads
    .filter(({ success }) => !success)
    .map(({ name, controlledFailure: receivedFault, duplicate }) => ({
      name,
      controlledFailure: receivedFault,
      duplicate,
    }))
  assert.deepEqual(
    failures,
    controlledFailure === undefined
      ? []
      : [
          {
            name: controlledFailure.name,
            controlledFailure: true,
            duplicate: false,
          },
        ],
    'HTTP retry does not republish successful or already-current versions',
  )
}
