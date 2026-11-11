/**
 * Candidates and stable versions must reach latest, independent of registry
 * history (maintainer decision 2026-10-29, recorded in CONTRIBUTING.md).
 * Stable minors are the maintainer's deliberate policy. The shared model states the independent
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
import { oracleProperty } from '../packages/db/tests/oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../packages/db/tests/oracle-assertion-adapter.js'
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

import { requiredStateRecorder } from './required-state-recorder.js'

async function receiveCommand(history, observe) {
  const reach = requiredStateRecorder(
    [
      'registry-read',
      'restored',
      'compared',
      ...(history.failure === 'none' ? [] : ['failure-observed', 'retried']),
      ...(history.registry === 'current'
        ? ['already-current']
        : ['new-version']),
    ],
    observe,
  )
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
        throw new Error('Command failed outside controlled registry failure', {
          cause: commandError,
        })
    } else {
      const failure = firstRequests.find(
        (entry) => entry.type === 'publish' && !entry.success,
      )
      // A setup failure is not evidence for retry or restoration. The exact
      // controlled failed request must exist before the expected error counts.
      if (!failure || !commandError)
        throw new Error('Controlled package-publish failure was not observed', {
          cause: commandError,
        })
      oracleAssertion(`existing release comparison`, () =>
        assert.equal(
          failure.name,
          history.failure === 'stable' ? packageNames.query : packageNames.db,
          'failure reaches its requested publish phase',
        ),
      )
      reach.enter('failure-observed')
    }
    oracleAssertion(`existing release comparison`, () =>
      assert.deepEqual(
        receiver.bytes(),
        before,
        'publish attempt restores original workspace bytes',
      ),
    )
    if (history.failure !== 'none') {
      await receiver.run(publishDuringRc)
      oracleAssertion(`existing release comparison`, () =>
        assert.deepEqual(
          receiver.bytes(),
          before,
          'publish retry restores original workspace bytes',
        ),
      )
      reach.enter('retried')
    }
    reach.enter('restored')
    const requests = receiver.readRequests()
    const infoNames = new Set(
      requests
        .filter((entry) => entry.type === 'info')
        .map((entry) => entry.name),
    )
    oracleAssertion(`existing release comparison`, () =>
      assert.deepEqual(
        [...infoNames].sort(),
        Object.values(packageNames).sort(),
        'real Changesets inspected both candidate and stable package phases',
      ),
    )
    reach.enter('registry-read')
    const failures = requests.filter(
      (entry) => entry.type === 'publish' && !entry.success,
    )
    oracleAssertion(`existing release comparison`, () =>
      assert.equal(
        failures.length,
        history.failure === 'none' ? 0 : 1,
        'the retry has exactly one controlled failed request',
      ),
    )
    oracleAssertion(`existing release comparison`, () =>
      checkPublishObservation(
        requests,
        expected,
        'registry after publish and optional retry',
      ),
    )
    reach.enter('compared')
    reach.enter(
      history.registry === 'current' ? 'already-current' : 'new-version',
    )
    reach.assertComplete()
  })
}

// The complete existing independent helper retains every comparison cut. Native
// enumeration supplies stable exact-case titles, data checks, and determinism.
oracleProperty({
  id: 'scripts.publish-command',
  law: {
    statement:
      'Release versioning and publication refine the independent ledger at every original observation cut.',
    authority:
      'CONTRIBUTING.md: Changesets and Releases; maintainer policy decision 2026-10-29.',
    limits:
      'The unchanged finite histories and real-tool receiving boundary described above.',
  },
  histories: publishHistories,
  label: (history) =>
    'release command registry history ' + JSON.stringify(history),
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment('release ledger', plan, observe, () =>
      receiveCommand(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
  // Native determinism runs up to eight cases twice in one Vitest test.
  // Existing receiving child-process timeouts remain unchanged.
  timeout: 20_000 * 16,
})
