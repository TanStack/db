/**
 * Candidates must reach rc and stable versions must reach latest, independent
 * of registry history. CONTRIBUTING.md supplies this policy; stable minors are
 * the maintainer's deliberate policy. The shared model states the independent
 * version/tag law. A registry ledger is controlled input, not a tag classifier.
 *
 * The receiver invokes production publishDuringRc with its default command.
 * A strict pnpm shim forwards that command to the installed real Changesets
 * CLI. Strict npm/pnpm shims then supply registry metadata and record every info
 * and publish attempt, including failures. No process falls through to npm or
 * a real registry. Successful partial publishes persist across one retry;
 * manifest/pre-state restoration is compared after each attempt.
 *
 * This finite grammar crosses numeric candidate boundaries, stable/only-RC/
 * empty/already-current registry histories and failure in either publish phase.
 * An already-current workspace cannot have an attempted publish failure, so
 * those impossible cells are excluded. Npm HTTP, tarballs, installed consumers,
 * credential authentication and GitHub Actions themselves are not claimed.
 */
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { declareOracle } from '../packages/db/tests/oracle-declaration.js'
import { createOracleReach } from '../packages/db/tests/oracle-reach.js'
import {
  checkPublishObservation,
  expectedPublishes,
  packageNames,
  publishHistories,
} from './release-history-oracle.js'
import {
  preparePublishReceiver,
  withReleaseWorkspace,
} from './release-fixture.js'
import { publishDuringRc } from './publish-packages.mjs'

declareOracle({
  check: [checkPublishObservation],
  model: [expectedPublishes],
  grammar: [publishHistories],
})

test.each(publishHistories)(
  'release command registry history %j',
  async (history) => {
    const reach = createOracleReach(
      'release.command-registry',
      [
        'registry-read',
        'restored',
        'compared',
        ...(history.failure === 'none' ? [] : ['failure-observed', 'retried']),
        ...(history.registry === 'current'
          ? ['already-current']
          : ['new-version']),
      ],
      { replaying: false },
    )
    reach.beginHistory()
    await withReleaseWorkspace(async ({ root }) => {
      const receiver = preparePublishReceiver(root, history)
      const expected = expectedPublishes(
        receiver.manifests,
        receiver.initialRegistry,
      )
      const before = receiver.bytes()
      let commandError
      try {
        await receiver.run(publishDuringRc)
      } catch (error) {
        commandError = error
      }
      const firstRequests = receiver.readRequests()
      if (history.failure === 'none') {
        if (commandError)
          throw new Error(
            'Command failed outside controlled registry failure',
            { cause: commandError },
          )
      } else {
        const failure = firstRequests.find(
          (entry) => entry.type === 'publish' && !entry.success,
        )
        // A setup failure is not evidence for retry or restoration. The exact
        // controlled failed request must exist before the expected error counts.
        if (!failure || !commandError)
          throw new Error(
            'Controlled package-publish failure was not observed',
            { cause: commandError },
          )
        assert.equal(
          failure.name,
          history.failure === 'stable' ? packageNames.query : packageNames.db,
          'failure reaches its requested publish phase',
        )
        reach.reach('failure-observed')
      }
      assert.deepEqual(
        receiver.bytes(),
        before,
        'publish attempt restores original workspace bytes',
      )
      if (history.failure !== 'none') {
        await receiver.run(publishDuringRc)
        assert.deepEqual(
          receiver.bytes(),
          before,
          'publish retry restores original workspace bytes',
        )
        reach.reach('retried')
      }
      reach.reach('restored')
      const requests = receiver.readRequests()
      const infoNames = new Set(
        requests
          .filter((entry) => entry.type === 'info')
          .map((entry) => entry.name),
      )
      assert.deepEqual(
        [...infoNames].sort(),
        Object.values(packageNames).sort(),
        'real Changesets inspected both candidate and stable package phases',
      )
      reach.reach('registry-read')
      const failures = requests.filter(
        (entry) => entry.type === 'publish' && !entry.success,
      )
      assert.equal(
        failures.length,
        history.failure === 'none' ? 0 : 1,
        'the retry has exactly one controlled failed request',
      )
      checkPublishObservation(
        requests,
        expected,
        'registry after publish and optional retry',
      )
      reach.reach('compared')
      reach.reach(
        history.registry === 'current' ? 'already-current' : 'new-version',
      )
      reach.assertReached()
    })
  },
  20_000,
)

// Wrong observations reuse the same judgment as the command receiver. Sorting
// permits concurrent package order, but must retain omission and multiplicity.
test.each(['duplicate', 'omission', 'tag', 'version', 'registry', 'access'])(
  'release publish judgment rejects wrong %s observation',
  (fault) => {
    const expected = [
      { name: packageNames.db, version: '1.0.0-rc.1.10', tag: 'rc' },
    ]
    const correct = [
      {
        type: 'publish',
        ...expected[0],
        success: true,
        registry: 'http://127.0.0.1:4873',
        access: 'public',
      },
    ]
    checkPublishObservation(correct, expected, 'legal calibration')
    const wrong = structuredClone(correct)
    if (fault === 'duplicate') wrong.push({ ...wrong[0] })
    else if (fault === 'omission') wrong.length = 0
    else
      wrong[0][fault] =
        fault === 'tag'
          ? 'latest'
          : fault === 'version'
            ? '1.0.0-rc.1.9'
            : fault === 'registry'
              ? 'https://example.invalid'
              : 'restricted'
    assert.throws(() =>
      checkPublishObservation(wrong, expected, 'wrong calibration'),
    )
  },
)
