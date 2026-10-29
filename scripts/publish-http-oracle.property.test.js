/**
 * Candidate and stable releases reach latest exactly once.
 * Authority: CONTRIBUTING.md Changesets/Releases, maintainer decision 2026-10-29.
 * The existing release ledger supplies the independent version/tag judgment.
 * This receiver crosses the real npm11/pnpm11/Changesets HTTP boundary, with
 * the default production publish command and real package-manager archives.
 * No command shim chooses a tag or fabricates a successful publication.
 *
 * The bounded shared grammar retains the original metadata/failure histories
 * and varies exact-version presence independently of tags. Current candidates
 * can have only latest, no tags, or rc pointing to an older present version.
 * A historical old-policy wrong-tag aftermath keeps old rc alongside
 * latest=current. A separate stable-phase neighbor removes stable latest
 * while versions remain.
 * Missing targets also have a no-tags neighbor. Two different candidate
 * versions vary which package is already current and reverse their assignment.
 * A later-candidate fault follows an actual successful candidate upload, in
 * either package order. Retry must retain it without another upload.
 * Replay selects the complete unique Vitest test title; this finite enumeration
 * has no seed/shrink interface and claims no arbitrary schedules or semver.
 *
 * The fixture supplies local workspace links directly for packing. It disables
 * automatic installation, isolates configuration/cache/credentials and keeps
 * HOME unchanged. This establishes HTTP uploads and packed manifest identity,
 * not repository installation, consumer APIs, production authentication or
 * GitHub Actions. POSIX process groups are required. Standard tools and their
 * required loopback socket access are setup premises; missing tools, malformed
 * protocol or timeout are fixture/runtime failures, not tag-law RED evidence.
 */
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { declareOracle } from '../packages/db/tests/oracle-declaration.js'
import { createOracleReach } from '../packages/db/tests/oracle-reach.js'
import {
  checkPublishObservation,
  expectedPublishes,
  httpPublishHistories,
  packageNames,
} from './release-history-oracle.js'
import { withReleaseWorkspace } from './release-fixture.js'
import { withHttpPublishReceiver } from './release-http-fixture.js'

const histories = httpPublishHistories

// Final versions and tags follow the authored initial ledger plus each expected
// successful publication once. This rule does not classify npm's packuments.
function checkRegistry(state, initial, expected) {
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
function checkHttpUploadFailures(uploads, controlledFailure) {
  const failures = uploads
    .filter(({ success }) => !success)
    .map(({ name, controlledFailure, duplicate }) => ({
      name,
      controlledFailure,
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

function requireSupportedProtocol(state) {
  const unexpected = state.requests.filter(
    ({ type }) => type === 'protocol-error' || type === 'request-error',
  )
  if (unexpected.length > 0)
    throw new Error(
      `HTTP fixture does not support the actual tool protocol: ${JSON.stringify(unexpected)}`,
    )
}

declareOracle({
  check: [checkPublishObservation, checkRegistry, checkHttpUploadFailures],
  model: [expectedPublishes],
  grammar: [histories],
})

test('finite HTTP grammar keeps every history independently selectable', () => {
  assert.equal(
    new Set(histories.map((history) => JSON.stringify(history))).size,
    histories.length,
    'complete JSON test titles identify exactly one history',
  )
})

test.each(histories)(
  'publishes through real npm/pnpm HTTP %j',
  async (history) => {
    const reach = createOracleReach(
      'release.http-registry',
      [
        'stable-registry-read',
        'candidate-registry-read',
        'registry-read',
        'restored',
        'compared',
        ...(history.registry === 'current'
          ? ['already-current']
          : ['packed-upload']),
        ...(history.failure === 'none'
          ? []
          : ['controlled-failure', 'partial-publication', 'retry']),
        ...(history.tagShape === 'ordinary'
          ? []
          : [`metadata-${history.tagShape}`]),
        ...(history.stableTagShape === 'no-tags'
          ? ['stable-metadata-no-tags']
          : []),
        ...(history.reactCandidate === undefined
          ? []
          : ['different-candidate-versions']),
        ...(history.currentCandidate === undefined
          ? []
          : ['mixed-current-and-missing']),
        ...(history.failure === 'candidate-after-success'
          ? ['candidate-success-before-failure']
          : []),
        ...(history.registry === 'current' ? [] : ['missing-exact-candidate']),
      ],
      { replaying: false },
    )
    reach.beginHistory()
    let tools
    let observation
    let didFail = false
    let primary
    try {
      await withReleaseWorkspace(async ({ root }) =>
        withHttpPublishReceiver(root, history, async (receiver) => {
          tools = receiver.tools
          const expected = expectedPublishes(
            receiver.manifests,
            receiver.initialRegistry,
          )
          const before = receiver.bytes()
          let firstError
          let retryError
          let controlledFailure
          try {
            await receiver.run()
          } catch (error) {
            firstError = error
          }
          let state = receiver.readState()
          observation = state
          requireSupportedProtocol(state)
          assert.deepEqual(
            receiver.bytes(),
            before,
            'first HTTP attempt restores original workspace bytes',
          )
          if (history.failure === 'none') {
            if (
              firstError &&
              !state.requests.some(({ type }) => type === 'publish')
            )
              throw new Error(
                'HTTP release failed before any publication request',
                { cause: firstError },
              )
          } else {
            const failed = state.requests.filter(
              ({ type, controlledFailure }) =>
                type === 'publish' && controlledFailure,
            )
            if (failed.length === 0 || firstError === undefined)
              throw new Error(
                'HTTP controlled failure boundary was not received',
                { cause: firstError },
              )
            assert.equal(failed.length, 1, 'one controlled failed HTTP request')
            controlledFailure = failed[0]
            if (history.failure === 'candidate-after-success') {
              assert(
                [packageNames.db, packageNames.react].includes(
                  controlledFailure.name,
                ),
                'the later controlled failure belongs to a candidate',
              )
              const failedIndex = state.requests.indexOf(controlledFailure)
              assert(
                state.requests
                  .slice(0, failedIndex)
                  .some(
                    ({ type, success, name }) =>
                      type === 'publish' &&
                      success &&
                      [packageNames.db, packageNames.react].includes(name),
                  ),
                'an actual candidate success precedes the later candidate failure',
              )
              reach.reach('candidate-success-before-failure')
            } else
              assert.equal(
                controlledFailure.name,
                history.failure === 'stable'
                  ? packageNames.query
                  : packageNames.db,
              )
            reach.reach('controlled-failure')
            assert(
              state.requests.some(
                ({ type, success }) => type === 'publish' && success,
              ),
              'successful partial publications precede retry',
            )
            reach.reach('partial-publication')
            try {
              await receiver.run()
            } catch (error) {
              retryError = error
            }
            state = receiver.readState()
            observation = state
            requireSupportedProtocol(state)
            assert.deepEqual(
              receiver.bytes(),
              before,
              'HTTP retry restores original workspace bytes',
            )
            reach.reach('retry')
          }
          reach.reach('restored')
          const metadata = state.requests.filter(({ type }) => type === 'info')
          const infos = new Set(metadata.map(({ name }) => name))
          // The first GET carries source facts before that package can be uploaded.
          // A stable-phase duplicate can stop the command before any candidate read.
          // Record each actual receiving path before judging raw failed attempts.
          for (const [name, initial] of Object.entries(
            receiver.initialRegistry,
          )) {
            const info = metadata.find((entry) => entry.name === name)
            if (info !== undefined)
              assert.deepEqual(
                { versions: info.versions, tags: info.tags },
                initial,
                'real npm receives exact initial version and tag facts',
              )
          }
          const stableRead = [packageNames.query, packageNames.offline].every(
            (name) => infos.has(name),
          )
          const candidateRead = [packageNames.db, packageNames.react].every(
            (name) => infos.has(name),
          )
          if (stableRead) {
            reach.reach('stable-registry-read')
            if (history.stableTagShape === 'no-tags')
              reach.reach('stable-metadata-no-tags')
          }
          if (candidateRead) {
            reach.reach('candidate-registry-read')
            if (history.tagShape !== 'ordinary')
              reach.reach(`metadata-${history.tagShape}`)
            if (history.reactCandidate !== undefined) {
              assert.notEqual(
                receiver.manifests[0].version,
                receiver.manifests[1].version,
              )
              reach.reach('different-candidate-versions')
            }
            const candidateExpected = expected.filter(({ name }) =>
              [packageNames.db, packageNames.react].includes(name),
            )
            if (history.currentCandidate !== undefined) {
              assert.equal(
                candidateExpected.length,
                1,
                'exactly one candidate target is missing',
              )
              reach.reach('mixed-current-and-missing')
            }
            if (history.registry !== 'current') {
              assert(
                candidateExpected.length > 0,
                'at least one exact candidate target is missing',
              )
              reach.reach('missing-exact-candidate')
            }
          }
          if (stableRead && candidateRead) reach.reach('registry-read')
          const uploads = state.requests.filter(
            ({ type }) => type === 'publish',
          )
          checkHttpUploadFailures(uploads, controlledFailure)
          assert.deepEqual(
            [...infos].sort(),
            Object.values(packageNames).sort(),
            'both package phases reached registry metadata',
          )
          if (history.failure === 'none')
            assert.equal(
              firstError,
              undefined,
              'publication without controlled failure fulfills',
            )
          else
            assert.equal(
              retryError,
              undefined,
              'retry after controlled failure fulfills',
            )
          for (const upload of uploads) {
            assert.deepEqual(
              { name: upload.archive.name, version: upload.archive.version },
              { name: upload.name, version: upload.version },
              'real packed manifest matches publication',
            )
            assert(upload.archive.files > 0, 'actual packed files arrived')
          }
          if (history.registry === 'current') {
            assert.equal(
              uploads.length,
              0,
              'already-current registry requires no uploads',
            )
            reach.reach('already-current')
          } else {
            assert(uploads.length > 0, 'real packed publication path ran')
            reach.reach('packed-upload')
          }
          checkPublishObservation(
            state.requests,
            expected,
            'real HTTP publication and optional retry',
            receiver.origin,
          )
          checkRegistry(state, receiver.initialRegistry, expected)
          reach.reach('compared')
          reach.assertReached()
        }),
      )
    } catch (error) {
      didFail = true
      primary = error
      throw error
    } finally {
      if (process.env.TANSTACK_DB_ORACLE_STATISTICS === '1') {
        try {
          console.info(
            'HTTP release reach',
            JSON.stringify({
              history,
              tools,
              states: Object.fromEntries(reach.counts()),
              observation,
            }),
          )
        } catch (report) {
          throw didFail
            ? new AggregateError(
                [primary, report],
                'HTTP release comparison and reach reporting failures',
                { cause: primary },
              )
            : report
        }
      }
    }
  },
  45_000,
)

test.each(['already-current', 'retained-success'])(
  'rejects duplicate HTTP attempts for %s',
  (shape) => {
    const fault = {
      name: packageNames.query,
      success: false,
      controlledFailure: true,
      duplicate: false,
    }
    const duplicate = {
      name: packageNames.db,
      success: false,
      controlledFailure: false,
      duplicate: true,
    }
    const actual =
      shape === 'already-current' ? [duplicate] : [fault, duplicate]
    assert.throws(
      () =>
        checkHttpUploadFailures(
          actual,
          shape === 'already-current' ? undefined : fault,
        ),
      /HTTP retry does not republish/,
    )
  },
)

test.each(['default', 'variable-origin', 'foreign-origin'])(
  'retains registry-origin judgment %s',
  (shape) => {
    const expected = [
      { name: packageNames.db, version: '1.0.0-rc.1.10', tag: 'rc' },
    ]
    const registry =
      shape === 'default' ? 'http://127.0.0.1:4873' : 'http://127.0.0.1:61234'
    const observation = [
      {
        ...expected[0],
        type: 'publish',
        success: true,
        access: 'public',
        registry,
      },
    ]
    if (shape === 'default')
      checkPublishObservation(observation, expected, 'default origin')
    else {
      checkPublishObservation(
        observation,
        expected,
        'variable loopback origin',
        registry,
      )
      if (shape === 'foreign-origin')
        assert.throws(() =>
          checkPublishObservation(
            [{ ...observation[0], registry: 'https://example.invalid' }],
            expected,
            'foreign observation',
            registry,
          ),
        )
    }
  },
)
