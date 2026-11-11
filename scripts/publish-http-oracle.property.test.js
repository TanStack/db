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
 * Private-version policies and public runtime/peer dependency edges cannot
 * change that ledger. Actual archives retain authored ranges, with workspace:*
 * replaced by its target version. Every attempt restores the original config,
 * prerelease state and public/private manifest bytes, including config spacing.
 * Replay selects the complete unique Vitest test title; this finite enumeration
 * has no seed/shrink interface and claims no arbitrary schedules or semver.
 *
 * The fixture supplies local workspace links directly for packing. It disables
 * automatic installation, isolates configuration/cache/credentials and keeps
 * HOME unchanged. This establishes HTTP uploads and packed manifest edges,
 * not repository installation, consumer APIs, production authentication or
 * GitHub Actions. POSIX process groups are required. Standard tools and their
 * required loopback socket access are setup premises; missing tools, malformed
 * protocol or timeout are fixture/runtime failures, not tag-law RED evidence.
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
  expectedPackedDependencies,
  expectedPublishes,
  httpPublishHistories,
  packageNames,
} from './release-history-oracle.js'
import { withReleaseWorkspace } from './release-fixture.js'
import { withHttpPublishReceiver } from './release-http-fixture.js'

import {
  checkHttpUploadFailures,
  checkRegistry,
} from './publish-observation-oracle.js'

import { requiredStateRecorder } from './required-state-recorder.js'

const histories = httpPublishHistories

function requireSupportedProtocol(state) {
  const unexpected = state.requests.filter(
    ({ type }) => type === 'protocol-error' || type === 'request-error',
  )
  if (unexpected.length > 0)
    throw new Error(
      `HTTP fixture does not support the actual tool protocol: ${JSON.stringify(unexpected)}`,
    )
}

async function receiveHttp(history, observe) {
  const reach = requiredStateRecorder(
    [
      'stable-registry-read',
      'candidate-registry-read',
      'registry-read',
      'restored',
      'compared',
      'public-dependent',
      `private-policy-${history.privatePolicy ?? 'skip'}`,
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
    observe,
  )
  let tools
  let observation
  let didFail = false
  let primary
  try {
    await withReleaseWorkspace(
      async ({ root }) =>
        withHttpPublishReceiver(root, history, async (receiver) => {
          tools = receiver.tools
          const expected = expectedPublishes(
            receiver.manifests,
            receiver.initialRegistry,
          )
          const before = receiver.bytes()
          const dependent = receiver.manifests.find(
            ({ name }) => name === packageNames.offline,
          )
          oracleAssertion(`existing release comparison`, () =>
            assert.equal(
              (history.stableDependency
                ? dependent.dependencies
                : dependent.peerDependencies)[packageNames.db],
              history.stableDependency ? 'workspace:*' : '^1.0.0-rc.0',
              'public stable dependent retains its authored candidate edge',
            ),
          )
          reach.enter('public-dependent')
          reach.enter(`private-policy-${history.privatePolicy ?? 'skip'}`)
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
          oracleAssertion(`existing release comparison`, () =>
            assert.deepEqual(
              receiver.bytes(),
              before,
              'first HTTP attempt restores original workspace bytes',
            ),
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
              ({ type, controlledFailure: receivedFault }) =>
                type === 'publish' && receivedFault,
            )
            if (failed.length === 0 || firstError === undefined)
              throw new Error(
                'HTTP controlled failure boundary was not received',
                { cause: firstError },
              )
            oracleAssertion(`existing release comparison`, () =>
              assert.equal(
                failed.length,
                1,
                'one controlled failed HTTP request',
              ),
            )
            controlledFailure = failed[0]
            if (history.failure === 'candidate-after-success') {
              oracleAssertion(`existing release comparison`, () =>
                assert(
                  [packageNames.db, packageNames.react].includes(
                    controlledFailure.name,
                  ),
                  'the later controlled failure belongs to a candidate',
                ),
              )
              const failedIndex = state.requests.indexOf(controlledFailure)
              oracleAssertion(`existing release comparison`, () =>
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
                ),
              )
              reach.enter('candidate-success-before-failure')
            } else
              oracleAssertion(`existing release comparison`, () =>
                assert.equal(
                  controlledFailure.name,
                  history.failure === 'stable'
                    ? packageNames.query
                    : packageNames.db,
                ),
              )
            reach.enter('controlled-failure')
            oracleAssertion(`existing release comparison`, () =>
              assert(
                state.requests.some(
                  ({ type, success }) => type === 'publish' && success,
                ),
                'successful partial publications precede retry',
              ),
            )
            reach.enter('partial-publication')
            try {
              await receiver.run()
            } catch (error) {
              retryError = error
            }
            state = receiver.readState()
            observation = state
            requireSupportedProtocol(state)
            oracleAssertion(`existing release comparison`, () =>
              assert.deepEqual(
                receiver.bytes(),
                before,
                'HTTP retry restores original workspace bytes',
              ),
            )
            reach.enter('retry')
          }
          reach.enter('restored')
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
              oracleAssertion(`existing release comparison`, () =>
                assert.deepEqual(
                  { versions: info.versions, tags: info.tags },
                  initial,
                  'real npm receives exact initial version and tag facts',
                ),
              )
          }
          const stableRead = [packageNames.query, packageNames.offline].every(
            (name) => infos.has(name),
          )
          const candidateRead = [packageNames.db, packageNames.react].every(
            (name) => infos.has(name),
          )
          if (stableRead) {
            reach.enter('stable-registry-read')
            if (history.stableTagShape === 'no-tags')
              reach.enter('stable-metadata-no-tags')
          }
          if (candidateRead) {
            reach.enter('candidate-registry-read')
            if (history.tagShape !== 'ordinary')
              reach.enter(`metadata-${history.tagShape}`)
            if (history.reactCandidate !== undefined) {
              oracleAssertion(`existing release comparison`, () =>
                assert.notEqual(
                  receiver.manifests[0].version,
                  receiver.manifests[1].version,
                ),
              )
              reach.enter('different-candidate-versions')
            }
            const candidateExpected = expected.filter(({ name }) =>
              [packageNames.db, packageNames.react].includes(name),
            )
            if (history.currentCandidate !== undefined) {
              oracleAssertion(`existing release comparison`, () =>
                assert.equal(
                  candidateExpected.length,
                  1,
                  'exactly one candidate target is missing',
                ),
              )
              reach.enter('mixed-current-and-missing')
            }
            if (history.registry !== 'current') {
              oracleAssertion(`existing release comparison`, () =>
                assert(
                  candidateExpected.length > 0,
                  'at least one exact candidate target is missing',
                ),
              )
              reach.enter('missing-exact-candidate')
            }
          }
          if (stableRead && candidateRead) reach.enter('registry-read')
          const uploads = state.requests.filter(
            ({ type }) => type === 'publish',
          )
          oracleAssertion(`existing release comparison`, () =>
            checkHttpUploadFailures(uploads, controlledFailure),
          )
          oracleAssertion(`existing release comparison`, () =>
            assert.deepEqual(
              [...infos].sort(),
              Object.values(packageNames).sort(),
              'both package phases reached registry metadata',
            ),
          )
          if (history.failure === 'none')
            oracleAssertion(`existing release comparison`, () =>
              assert.equal(
                firstError,
                undefined,
                'publication without controlled failure fulfills',
              ),
            )
          else
            oracleAssertion(`existing release comparison`, () =>
              assert.equal(
                retryError,
                undefined,
                'retry after controlled failure fulfills',
              ),
            )
          for (const upload of uploads) {
            oracleAssertion(`existing release comparison`, () =>
              assert.deepEqual(
                { name: upload.archive.name, version: upload.archive.version },
                { name: upload.name, version: upload.version },
                'real packed manifest matches publication',
              ),
            )
            oracleAssertion(`existing release comparison`, () =>
              assert(upload.archive.files > 0, 'actual packed files arrived'),
            )
            oracleAssertion(`existing release comparison`, () =>
              assert.deepEqual(
                {
                  dependencies: upload.archive.dependencies,
                  peerDependencies: upload.archive.peerDependencies,
                },
                expectedPackedDependencies(
                  receiver.manifests,
                  receiver.manifests.find(({ name }) => name === upload.name),
                ),
                'packed runtime and peer dependencies retain authored edges',
              ),
            )
          }
          if (history.registry === 'current') {
            oracleAssertion(`existing release comparison`, () =>
              assert.equal(
                uploads.length,
                0,
                'already-current registry requires no uploads',
              ),
            )
            reach.enter('already-current')
          } else {
            oracleAssertion(`existing release comparison`, () =>
              assert(uploads.length > 0, 'real packed publication path ran'),
            )
            reach.enter('packed-upload')
          }
          oracleAssertion(`existing release comparison`, () =>
            checkPublishObservation(
              state.requests,
              expected,
              'real HTTP publication and optional retry',
              receiver.origin,
            ),
          )
          oracleAssertion(`existing release comparison`, () =>
            checkRegistry(state, receiver.initialRegistry, expected),
          )
          reach.enter('compared')
          reach.assertComplete()
        }),
      history.stableDependency ?? false,
    )
  } catch (error) {
    didFail = true
    primary = error
  }
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
  if (didFail) throw primary
}

// The complete existing independent helper retains every comparison cut. Native
// enumeration supplies stable exact-case titles, data checks, and determinism.
oracleProperty({
  id: 'scripts.publish-http',
  law: {
    statement:
      'Release versioning and publication refine the independent ledger at every original observation cut.',
    authority:
      'CONTRIBUTING.md: Changesets and Releases; maintainer policy decision 2026-10-29.',
    limits:
      'The unchanged finite histories and real-tool receiving boundary described above.',
    owner: 'Release tooling',
  },
  histories: histories,
  label: (history) =>
    'publishes through real npm/pnpm HTTP ' + JSON.stringify(history),
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment('release ledger', plan, observe, () =>
      receiveHttp(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
  // Native determinism runs up to eight cases twice in one Vitest test.
  // Existing receiving child-process timeouts remain unchanged.
  timeout: 45_000 * 16,
})
