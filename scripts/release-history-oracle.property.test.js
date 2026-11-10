/**
 * An RC release is a sequence, not an isolated version-string calculation.
 * The shared independent ledger states the authority and finite grammar.
 * This receiver runs real Changesets pre entry/exit and the production version
 * functions in disposable workspaces. After every action it compares package
 * versions, dependency protocols, consumed IDs and changelog attribution.
 *
 * The first/9-counter boundaries, independent stable work, maximum bump type,
 * direct versus peer edges and insertion order form a finite exhaustive set.
 * Unknown packages, reused IDs and release types outside the grammar are not
 * legal histories. Failure histories inject one seed write/pre-entry/changelog
 * failure and demand exact restoration before a successful retry. These are
 * initial seeding boundaries, not an atomicity promise for every later tool.
 * Native enumeration replays the exact case by its complete stable Vitest title.
 * No install, tarball, registry HTTP, or installed-consumer behavior is claimed.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { oracleProperty } from '../packages/db/tests/oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../packages/db/tests/oracle-assertion-adapter.js'
import {
  applyReleaseVersion,
  checkReleaseObservation,
  createReleaseModel,
  queueRelease,
  releaseHistories,
  seedFailureHistories,
} from './release-history-oracle.js'
import {
  addFixtureChangeset,
  enterRealPreMode,
  exitRealPreMode,
  observeRelease,
  repeatStableVersion,
  withReleaseWorkspace,
  workspaceBytes,
} from './release-fixture.js'
import {
  seedFirstCandidate,
  versionDuringRc,
  versionOnRcExit,
} from './version-packages.mjs'

import { requiredStateRecorder } from './required-state-recorder.js'

// Faults affect only seedFirstCandidate's synchronous write boundary. A single
// failure disarms itself so restoration can proceed. Fixture writes occur while
// disarmed; CJS Changesets writes are not counted as intercepted seed writes.
const fault = vi.hoisted(
  () =>
    /** @type {{remaining?: number, reached: boolean, afterApply: boolean, appliedToken: boolean}} */ ({
      remaining: undefined,
      reached: false,
      afterApply: false,
      appliedToken: false,
    }),
)
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    writeFileSync(...args) {
      if (fault.remaining !== undefined) {
        if (fault.remaining-- === 0) {
          fault.remaining = undefined
          fault.reached = true
          throw new Error('injected seed write failure')
        }
      }
      return actual.writeFileSync(...args)
    },
  }
})
vi.mock('@changesets/apply-release-plan', async (importOriginal) => {
  const actual = await importOriginal()
  const apply =
    typeof actual.default === 'function'
      ? actual.default
      : actual.default.default
  return {
    ...actual,
    default: async (...args) => {
      const result = await apply(...args)
      if (fault.afterApply) {
        fault.afterApply = false
        fault.reached = true
        const fs = await vi.importActual('node:fs')
        const path = join(args[4], 'packages', 'db', 'CHANGELOG.md')
        fault.appliedToken = fs
          .readFileSync(path, 'utf8')
          .includes('release-token:first-rc')
        throw new Error('injected failure after release files applied')
      }
      return result
    },
  }
})

const first = { db: 'major', react: 'major', query: 'minor', offline: 'minor' }

async function receiveVersion(history, observe) {
  const local = requiredStateRecorder(
    [
      'first-candidate',
      'mixed-work',
      'stable-only-work',
      'bump-precedence',
      'no-op',
      'stable-no-op',
      ...(history.boundary === 'candidate-nine'
        ? ['candidate-nine-to-ten']
        : []),
      ...(history.boundary === 'patch-nine' ? ['patch-nine-to-ten'] : []),
      ...(history.stableDependency ? ['dependent-stable-exit'] : []),
      ...(history.exitWork !== 'none' && history.strongest === 'minor'
        ? ['consumed-minor-pending-patch-exit']
        : []),
      history.exitWork === 'none'
        ? 'exit-no-pending'
        : history.exitWork === 'stable-only'
          ? 'exit-stable-only'
          : 'exit-candidate-pending',
    ],
    observe,
  )
  const reached = (state) => {
    local.enter(state)
  }
  await withReleaseWorkspace(async (fixture) => {
    const { root } = fixture
    let model = createReleaseModel(history.stableDependency)
    const queue = (id, releases) => {
      addFixtureChangeset(root, id, releases)
      queueRelease(model, id, releases)
    }
    const compare = (checkpoint) => {
      oracleAssertion(`existing release comparison`, () =>
        checkReleaseObservation(observeRelease(fixture), model, checkpoint),
      )
    }
    const version = async (checkpoint) => {
      await versionDuringRc(root)
      model = applyReleaseVersion(model)
      compare(checkpoint)
    }
    queue('first-rc', first)
    await seedFirstCandidate(root, () => enterRealPreMode(root))
    model = applyReleaseVersion(model)
    compare('first candidate')
    reached('first-candidate')

    if (history.boundary === 'candidate-nine') {
      for (let index = 1; index <= 8; index++) {
        queue(`warm-minor-${index}`, { db: 'minor' })
        await version(`candidate warmup ${index}`)
      }
    } else if (history.boundary === 'patch-nine') {
      for (let index = 1; index <= 9; index++) {
        queue(`warm-patch-${index}`, { db: 'patch' })
        await version(`patch warmup ${index}`)
      }
    }
    queue('isolated-stable', { offline: 'patch' })
    await version('stable work without any candidate release')
    reached('stable-only-work')
    const mixed = [
      ['mixed-patch', { db: 'patch', query: 'patch' }],
      ['stable-only', { offline: 'patch' }],
    ]
    if (history.reverse) mixed.reverse()
    for (const [id, releases] of mixed) queue(id, releases)
    await version('mixed and stable-only work')
    reached('mixed-work')
    if (history.boundary === 'patch-nine') reached('patch-nine-to-ten')
    const beforeNoop = workspaceBytes(root)
    await version('repeat without pending work')
    oracleAssertion(`existing release comparison`, () =>
      assert.deepEqual(
        workspaceBytes(root),
        beforeNoop,
        'no-op preserves workspace bytes',
      ),
    )
    reached('no-op')

    const precedence = [
      ['weaker', { db: 'patch', query: 'patch' }],
      ['stronger', { db: history.strongest, query: history.strongest }],
    ]
    if (history.reverse) precedence.reverse()
    for (const [id, releases] of precedence) queue(id, releases)
    await version('strongest pending bump wins')
    reached('bump-precedence')
    if (history.boundary === 'candidate-nine') reached('candidate-nine-to-ten')
    queue('independent-candidate', { react: 'patch' })
    await version('independent candidate patch')
    if (history.exitWork !== 'none')
      queue('pending-at-exit', {
        ...(history.exitWork === 'candidate-and-stable' ? { db: 'patch' } : {}),
        query: 'patch',
      })
    exitRealPreMode(root)
    await versionOnRcExit(root)
    model = applyReleaseVersion(model, { exit: true })
    compare('exit applies pending IDs once')
    if (history.exitWork !== 'none' && history.strongest === 'minor')
      reached('consumed-minor-pending-patch-exit')
    reached(
      history.exitWork === 'none'
        ? 'exit-no-pending'
        : history.exitWork === 'stable-only'
          ? 'exit-stable-only'
          : 'exit-candidate-pending',
    )
    if (history.stableDependency) reached('dependent-stable-exit')
    const afterExit = workspaceBytes(root)
    repeatStableVersion(root)
    compare('stable no-op after exit')
    oracleAssertion(`existing release comparison`, () =>
      assert.deepEqual(
        workspaceBytes(root),
        afterExit,
        'stable no-op preserves bytes',
      ),
    )
    reached('stable-no-op')
    local.assertComplete()
  }, history.stableDependency)
}

async function receiveFailure(history, observe) {
  const local = requiredStateRecorder(['restored', 'retried'], observe)
  await withReleaseWorkspace(async (fixture) => {
    const { root } = fixture
    const model = createReleaseModel(history.stableDependency)
    addFixtureChangeset(root, 'first-rc', first)
    queueRelease(model, 'first-rc', first)
    // Existing changelog bytes and the absence of others both require restore.
    writeFileSync(join(root, 'packages', 'db', 'CHANGELOG.md'), '# Existing\n')
    const before = workspaceBytes(root)
    const writeIndex = [
      'first-manifest',
      'second-manifest',
      'release-config',
    ].indexOf(history.failure)
    fault.remaining = writeIndex < 0 ? undefined : writeIndex
    fault.reached = false
    fault.afterApply = history.failure === 'after-apply'
    fault.appliedToken = false
    if (history.failure === 'changelog')
      process.env.RELEASE_ORACLE_CHANGELOG_FAIL = root
    try {
      await oracleAssertion(`existing release comparison`, () =>
        expect(
          seedFirstCandidate(root, () => {
            if (history.failure === 'before-pre') {
              fault.reached = true
              throw new Error('injected pre-entry failure')
            }
            enterRealPreMode(root)
            if (history.failure === 'after-pre') {
              fault.reached = true
              throw new Error('injected post-entry failure')
            }
          }),
        ).rejects.toThrow(/injected/),
      )
      if (history.failure === 'changelog') fault.reached = true
    } finally {
      fault.remaining = undefined
      fault.afterApply = false
      delete process.env.RELEASE_ORACLE_CHANGELOG_FAIL
    }
    oracleAssertion(`existing release comparison`, () =>
      assert.equal(fault.reached, true, 'the intended failure boundary ran'),
    )
    if (history.failure === 'after-apply')
      oracleAssertion(`existing release comparison`, () =>
        assert.equal(
          fault.appliedToken,
          true,
          'generated changelog write precedes the fault',
        ),
      )
    oracleAssertion(`existing release comparison`, () =>
      assert.deepEqual(
        workspaceBytes(root),
        before,
        'failed first candidate restores every fixture byte',
      ),
    )
    oracleAssertion(`existing release comparison`, () =>
      assert.equal(existsSync(join(root, '.changeset', 'pre.json')), false),
    )
    local.enter('restored')
    await seedFirstCandidate(root, () => enterRealPreMode(root))
    const expected = applyReleaseVersion(model)
    oracleAssertion(`existing release comparison`, () =>
      checkReleaseObservation(
        observeRelease(fixture),
        expected,
        'retry after seed failure',
      ),
    )
    local.enter('retried')
    oracleAssertion(`existing release comparison`, () =>
      assert.equal(
        readFileSync(
          join(root, 'packages', 'db', 'CHANGELOG.md'),
          'utf8',
        ).match(/release-token:first-rc/g).length,
        expected.tokens.db.length,
      ),
    )
    local.assertComplete()
  }, history.stableDependency)
}

// The complete existing independent helper retains every comparison cut. Native
// enumeration supplies stable exact-case titles, data checks, and determinism.
oracleProperty({
  id: 'scripts.release-version',
  law: {
    statement:
      'Release versioning and publication refine the independent ledger at every original observation cut.',
    authority:
      'CONTRIBUTING.md: Changesets and Releases; maintainer policy decision 2026-10-29.',
    limits:
      'The unchanged finite histories and real-tool receiving boundary described above.',
    owner: 'Release tooling',
  },
  histories: releaseHistories,
  label: (history) => 'release version history ' + JSON.stringify(history),
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment('release ledger', plan, observe, () =>
      receiveVersion(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
  timeout: 20000,
})

// The complete existing independent helper retains every comparison cut. Native
// enumeration supplies stable exact-case titles, data checks, and determinism.
oracleProperty({
  id: 'scripts.release-seed-failure',
  law: {
    statement:
      'Release versioning and publication refine the independent ledger at every original observation cut.',
    authority:
      'CONTRIBUTING.md: Changesets and Releases; maintainer policy decision 2026-10-29.',
    limits:
      'The unchanged finite histories and real-tool receiving boundary described above.',
    owner: 'Release tooling',
  },
  histories: seedFailureHistories,
  label: (history) =>
    'first candidate failure and retry ' + JSON.stringify(history),
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment('release ledger', plan, observe, () =>
      receiveFailure(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
  timeout: 20000,
})
