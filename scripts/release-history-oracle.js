/**
 * Release laws come from CONTRIBUTING.md's Changesets and Releases sections:
 * candidates start at 1.0.0-rc.1, patches extend the current candidate, and a
 * minor or major starts the next candidate. Stable packages use ordinary semver
 * and latest. Candidates also use latest (maintainer decision 2026-10-29,
 * recorded in CONTRIBUTING.md). Versioning consumes each changeset once.
 * Exit promotes candidates to 1.0.0 and applies only still-pending work.
 *
 * This independent model uses numeric tuples and an authored changeset ledger.
 * It imports no Changesets planner, production version helper, manifest parser,
 * or registry classifier. The bounded dependency law uses workspace:* edges:
 * changing their published exact target requires a dependent patch, as the
 * repository's updateInternalDependencies=patch policy specifies. Compatible
 * peers do not require that patch. This is not an arbitrary semver-range model.
 *
 * The model predicts manifests, consumed IDs and unique changelog tokens after
 * each version action, and successful version/tag writes after publishing.
 * npm HTTP, tarballs, installed consumers, general workspace discovery and
 * clean installation are separate receiving boundaries, not claims here.
 */
import assert from 'node:assert/strict'

export const packageNames = {
  db: '@tanstack/db',
  react: '@tanstack/react-db',
  query: '@tanstack/query-db-collection',
  offline: '@tanstack/offline-transactions',
}

// Exhaust these semantic boundaries rather than randomizing a larger grammar.
// Removing boundary loses numeric 9->10; removing dependency loses stable
// dependent exit; removing strongest loses major-vs-minor precedence. Reversing
// pending insertion order must not change the maximum requested release type.
export const releaseHistories = [
  'first',
  'candidate-nine',
  'patch-nine',
].flatMap((boundary) =>
  [false, true].flatMap((stableDependency) =>
    ['minor', 'major'].flatMap((strongest) =>
      [false, true].flatMap((reverse) =>
        ['none', 'stable-only', 'candidate-and-stable'].map((exitWork) => ({
          boundary,
          stableDependency,
          strongest,
          reverse,
          exitWork,
        })),
      ),
    ),
  ),
)

export const publishHistories = [
  '1.0.0-rc.1.9',
  '1.0.0-rc.1.10',
  '1.0.0-rc.9',
  '1.0.0-rc.10',
].flatMap((candidate) =>
  ['stable-history', 'only-rc', 'never', 'current'].flatMap((registry) =>
    (registry === 'current' ? ['none'] : ['none', 'stable', 'candidate']).map(
      (failure) => ({
        candidate,
        registry,
        failure,
      }),
    ),
  ),
)

// HTTP reception exhausts the original fourteen metadata/failure forms, then
// adds independent neighboring facts. Exact version presence and tag shape are
// separate: a tag is not proof that another version is absent. Heterogeneous
// assignments also prohibit treating all candidate manifests as one version.
// Bounded enumeration has direct replay by the complete unique Vitest title;
// it makes no seeded/random-schedule or arbitrary-semver coverage claim.
export const httpPublishHistories = [
  ...publishHistories
    .filter(({ candidate }) => candidate === '1.0.0-rc.1.10')
    .flatMap((history) =>
      ['only-rc', 'current'].includes(history.registry)
        ? ['rc-only', 'latest-alias'].map((tagShape) => ({
            ...history,
            tagShape,
          }))
        : [{ ...history, tagShape: 'ordinary' }],
    ),
  ...['latest-only', 'no-tags', 'older-rc', 'older-rc-latest-current'].map(
    (tagShape) => ({
      candidate: '1.0.0-rc.1.10',
      registry: 'current',
      failure: 'none',
      tagShape,
    }),
  ),
  {
    candidate: '1.0.0-rc.1.10',
    registry: 'current',
    failure: 'none',
    tagShape: 'latest-alias',
    stableTagShape: 'no-tags',
  },
  ...['none', 'candidate'].map((failure) => ({
    candidate: '1.0.0-rc.1.10',
    registry: 'only-rc',
    failure,
    tagShape: 'no-tags',
  })),
  ...[false, true].flatMap((reverse) =>
    [
      { currentCandidate: undefined, failure: 'none' },
      { currentCandidate: undefined, failure: 'candidate-after-success' },
      { currentCandidate: 'db', failure: 'none' },
      { currentCandidate: 'react', failure: 'none' },
    ].map(({ currentCandidate, failure }) => ({
      candidate: reverse ? '1.0.0-rc.2' : '1.0.0-rc.1.10',
      reactCandidate: reverse ? '1.0.0-rc.1.10' : '1.0.0-rc.2',
      registry: currentCandidate === undefined ? 'stable-history' : 'only-rc',
      tagShape: currentCandidate === undefined ? 'ordinary' : 'latest-alias',
      ...(currentCandidate === undefined ? {} : { currentCandidate }),
      failure,
    })),
  ),
]

export const seedFailureHistories = [
  'first-manifest',
  'second-manifest',
  'release-config',
  'before-pre',
  'after-pre',
  'changelog',
  'after-apply',
].flatMap((failure) =>
  [false, true].map((stableDependency) => ({ failure, stableDependency })),
)

const strength = { none: 0, patch: 1, minor: 2, major: 3 }
const strongest = (a, b) => (strength[a] >= strength[b] ? a : b)
const copy = (value) => structuredClone(value)

export function createReleaseModel(stableDependency) {
  return {
    mode: 'before',
    versions: {
      db: { candidate: 0, patch: 0 },
      react: { candidate: 0, patch: 0 },
      query: [1, 4, 8],
      offline: [1, 1, 4],
    },
    stableDependency,
    pending: [],
    consumed: [],
    tokens: Object.fromEntries(
      Object.keys(packageNames).map((key) => [key, []]),
    ),
  }
}

export function queueRelease(model, id, releases) {
  assert(!model.pending.some((entry) => entry.id === id))
  assert(!model.consumed.includes(id), 'changeset IDs cannot be reused')
  for (const [key, type] of Object.entries(releases)) {
    assert(
      key in packageNames,
      'the grammar names only public fixture packages',
    )
    assert(type in strength && type !== 'none', 'a release requires a bump')
  }
  model.pending.push({ id, releases: { ...releases } })
}

// Pending IDs and consumed IDs differ even when public versions match: a later
// version action must apply one and ignore the other. Candidate patch/counter
// states also differ: the next patch and minor distinguish their numeric value.
export function applyReleaseVersion(model, { exit = false } = {}) {
  const next = copy(model)
  const requested = Object.fromEntries(
    Object.keys(packageNames).map((key) => [key, 'none']),
  )
  for (const entry of next.pending)
    for (const [key, type] of Object.entries(entry.releases))
      requested[key] = strongest(requested[key], type)
  if (exit) {
    requested.db = strongest(requested.db, 'patch')
    requested.react = strongest(requested.react, 'patch')
  }
  if (requested.db !== 'none') {
    requested.react = strongest(requested.react, 'patch')
    if (next.stableDependency)
      requested.offline = strongest(requested.offline, 'patch')
  }
  for (const key of Object.keys(packageNames)) {
    const type = requested[key]
    if (type === 'none') continue
    const old = next.versions[key]
    if ('candidate' in old) {
      next.versions[key] = exit
        ? [1, 0, 0]
        : type === 'patch'
          ? { candidate: old.candidate, patch: old.patch + 1 }
          : { candidate: old.candidate + 1, patch: 0 }
    } else {
      const [major, minor, patch] = old
      next.versions[key] =
        type === 'major'
          ? [major + 1, 0, 0]
          : type === 'minor'
            ? [major, minor + 1, 0]
            : [major, minor, patch + 1]
    }
  }
  for (const entry of next.pending) {
    next.consumed.push(entry.id)
    for (const key of Object.keys(entry.releases))
      next.tokens[key].push({ id: entry.id, version: modelVersions(next)[key] })
  }
  next.pending = []
  next.mode = exit ? 'stable' : 'rc'
  return next
}

export function modelVersions(model) {
  return Object.fromEntries(
    Object.entries(model.versions).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.join('.')
        : `1.0.0-rc.${value.candidate}${value.patch ? `.${value.patch}` : ''}`,
    ]),
  )
}

export function checkReleaseObservation(actual, model, checkpoint) {
  const expected = modelVersions(model)
  assert.deepEqual(actual.versions, expected, `${checkpoint}: package versions`)
  // Order among independent same-version entries is not promised. Preserve
  // multiplicity, package and version attribution while comparing the bag.
  const tokens = (ledger) =>
    Object.fromEntries(
      Object.entries(ledger).map(([key, entries]) => [
        key,
        entries.map(({ id, version }) => `${version}:${id}`).sort(),
      ]),
    )
  assert.deepEqual(
    tokens(actual.tokens),
    tokens(model.tokens),
    `${checkpoint}: changelog ledger`,
  )
  assert.deepEqual(
    actual.privateManifest,
    actual.originalPrivateManifest,
    `${checkpoint}: private package is unchanged`,
  )
  assert.deepEqual(
    actual.ignoredDependency,
    'workspace:*',
    `${checkpoint}: ignored dev dependency is restored`,
  )
  if (model.mode === 'rc') {
    assert.deepEqual(actual.pre.mode, 'pre', `${checkpoint}: prerelease mode`)
    assert.deepEqual(
      [...actual.pre.changesets].sort(),
      [...model.consumed].sort(),
      `${checkpoint}: exactly consumed IDs`,
    )
    assert.deepEqual(
      actual.changesets.sort(),
      [...model.consumed, ...model.pending.map((entry) => entry.id)].sort(),
      `${checkpoint}: prerelease files remain replayable`,
    )
  } else {
    assert.equal(
      actual.pre,
      undefined,
      `${checkpoint}: exit removes prerelease state`,
    )
    assert.deepEqual(
      actual.changesets,
      [],
      `${checkpoint}: exit removes consumed files`,
    )
  }
  assert.equal(
    actual.dependencies.react,
    'workspace:*',
    `${checkpoint}: candidate direct dependency retains pack-time protocol`,
  )
  if (model.stableDependency)
    assert.equal(
      actual.dependencies.offline,
      'workspace:*',
      `${checkpoint}: stable direct dependency retains pack-time protocol`,
    )
  else
    assert.equal(
      actual.dependencies.offline,
      '^1.0.0-rc.0',
      `${checkpoint}: compatible stable peer stays broad`,
    )
  assert.equal(
    actual.dependencies.query,
    '^1.0.0-rc.0',
    `${checkpoint}: query peer retains RC capability requirement`,
  )
}

// Registry histories are external input, never a release-tag classifier. A
// successful publish writes the documented tag even if all old versions were
// candidates. Concurrent independent package attempts may arrive in any order.
export function expectedPublishes(manifests, registry) {
  return manifests
    .filter(
      (manifest) =>
        !manifest.private &&
        !registry[manifest.name].versions.includes(manifest.version),
    )
    .map((manifest) => ({
      name: manifest.name,
      version: manifest.version,
      tag: 'latest',
    }))
}

export function checkPublishObservation(
  actual,
  expected,
  checkpoint,
  expectedRegistry = 'http://127.0.0.1:4873',
) {
  const key = ({ name, version, tag }) => `${name}@${version}:${tag}`
  const successes = actual.filter(
    (entry) => entry.type === 'publish' && entry.success,
  )
  assert.deepEqual(
    successes.map(key).sort(),
    expected.map(key).sort(),
    `${checkpoint}: each unpublished version reaches its documented tag once`,
  )
  for (const entry of actual) {
    assert.equal(
      entry.registry,
      expectedRegistry,
      `${checkpoint}: local registry only`,
    )
    if (entry.type === 'publish')
      assert.equal(entry.access, 'public', `${checkpoint}: public access`)
  }
}
