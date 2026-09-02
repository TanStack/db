import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BTreeIndex,
  count,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  materialize,
} from '../../packages/db/src/index.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  Collection,
  SyncConfig,
} from '../../packages/db/src/index.js'

type Issue = {
  id: number
  status: `open` | `closed`
  authorId: number
  createdAt: number
  title: string
  body: string
  updateTick: number
}

type User = {
  id: number
  name: string
  reputation: number
}

type Comment = {
  id: number
  issueId: number
  authorId: number
  createdAt: number
  body: string
  updateTick: number
}

type ManualSyncUtils<T extends object, TKey extends string | number> = {
  begin: Parameters<SyncConfig<T, TKey>[`sync`]>[0][`begin`]
  write: (message: ChangeMessageOrDeleteKeyMessage<T, TKey>) => void
  commit: Parameters<SyncConfig<T, TKey>[`sync`]>[0][`commit`]
}

type ManualCollection<
  T extends object,
  TKey extends string | number,
> = Collection<T, TKey, ManualSyncUtils<T, TKey>, never, T>

type BenchmarkCollection = Collection<Record<string, unknown>, string | number>

type Fixture = {
  seed: number
  issues: ManualCollection<Issue, number>
  users: ManualCollection<User, number>
  comments: ManualCollection<Comment, number>
  issueById: Map<number, Issue>
  userById: Map<number, User>
  commentById: Map<number, Comment>
  visibleIssueId: number
  selectedIssueId: number
  nextCommentId: number
}

type BenchmarkOptions = {
  seed: number
  levels: Array<number>
  sourceIndexModes: Array<SourceIndexMode>
  mutationModes: Array<MutationMode>
  issueCount?: number
  userCount?: number
  commentCount?: number
  warmup: number
  iterations: number
  outDir: string
  outFile?: string
}

type FixtureScale = {
  label: string
  issueCount: number
  userCount: number
  commentCount: number
}

type BenchmarkRunOptions = {
  seed: number
  scale: FixtureScale
  issueCount: number
  userCount: number
  commentCount: number
  sourceIndexMode: SourceIndexMode
  warmup: number
  iterations: number
}

type Summary = {
  iterations: number
  medianMs: number
  p75Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  stddevMs: number
}

type RunResult = {
  query: string
  scenario: string
  scale: FixtureScale
  sourceIndexMode: SourceIndexMode
  mutationMode: MutationMode
  coldHydrateMs: number
  writeSummary: Summary
}

type MutationMode = `synced` | `optimistic`
type SourceIndexMode = `none` | `manual` | `auto`

type WriteCleanup = () => void | Promise<void>

type WriteResult = void | { cleanup: WriteCleanup }

type QueryCase = {
  name: string
  scenario: string
  createQuery: (fixture: Fixture) => BenchmarkCollection
  write: (
    fixture: Fixture,
    iteration: number,
    mutationMode: MutationMode,
  ) => WriteResult
}

const defaultOptions: BenchmarkOptions = {
  seed: 42,
  levels: [100, 1_000, 10_000],
  sourceIndexModes: [`none`, `manual`],
  mutationModes: [`synced`, `optimistic`],
  warmup: 10,
  iterations: 50,
  outDir: `.tmp/perf`,
}

const defaultCustomScale: FixtureScale = {
  label: `custom`,
  issueCount: 10_000,
  userCount: 1_000,
  commentCount: 40_000,
}

const options = parseArgs(process.argv.slice(2), defaultOptions)

const queryCases: Array<QueryCase> = [
  {
    name: `list: newest 50 open`,
    scenario: `visible issue update`,
    createQuery: ({ issues }) =>
      createLiveQueryCollection((q) =>
        q
          .from({ issue: issues })
          .where(({ issue }) => eq(issue.status, `open`))
          .orderBy(({ issue }) => issue.createdAt, `desc`)
          .limit(50)
          .select(({ issue }) => ({
            id: issue.id,
            title: issue.title,
            createdAt: issue.createdAt,
          })),
      ) as unknown as BenchmarkCollection,
    write: updateVisibleIssue,
  },
  {
    name: `list + author`,
    scenario: `visible author update`,
    createQuery: ({ issues, users }) =>
      createLiveQueryCollection((q) =>
        q
          .from({ issue: issues })
          .where(({ issue }) => eq(issue.status, `open`))
          .join({ author: users }, ({ issue, author }) =>
            eq(issue.authorId, author.id),
          )
          .orderBy(({ issue }) => issue.createdAt, `desc`)
          .limit(50)
          .select(({ issue, author }) => ({
            id: issue.id,
            title: issue.title,
            createdAt: issue.createdAt,
            authorName: author.name,
          })),
      ) as unknown as BenchmarkCollection,
    write: updateVisibleAuthor,
  },
  {
    name: `list + comment count`,
    scenario: `visible issue comment insert`,
    createQuery: ({ issues, comments }) =>
      createLiveQueryCollection((q) =>
        q
          .from({ issue: issues })
          .where(({ issue }) => eq(issue.status, `open`))
          .orderBy(({ issue }) => issue.createdAt, `desc`)
          .limit(50)
          .select(({ issue }) => ({
            id: issue.id,
            title: issue.title,
            commentCount: materialize(
              q
                .from({ comment: comments })
                .where(({ comment }) => eq(comment.issueId, issue.id))
                .select(({ comment }) => count(comment.id))
                .findOne(),
            ),
          })),
      ) as unknown as BenchmarkCollection,
    write: insertVisibleComment,
  },
  {
    name: `list + 3 recent comments`,
    scenario: `visible issue comment insert`,
    createQuery: ({ issues, comments }) =>
      createLiveQueryCollection((q) =>
        q
          .from({ issue: issues })
          .where(({ issue }) => eq(issue.status, `open`))
          .orderBy(({ issue }) => issue.createdAt, `desc`)
          .limit(50)
          .select(({ issue }) => ({
            id: issue.id,
            title: issue.title,
            recentComments: q
              .from({ comment: comments })
              .where(({ comment }) => eq(comment.issueId, issue.id))
              .orderBy(({ comment }) => comment.createdAt, `desc`)
              .limit(3)
              .select(({ comment }) => ({
                id: comment.id,
                body: comment.body,
                createdAt: comment.createdAt,
              })),
          })),
      ) as unknown as BenchmarkCollection,
    write: insertVisibleComment,
  },
  {
    name: `issue detail + comments`,
    scenario: `selected issue comment insert`,
    createQuery: ({ issues, comments, selectedIssueId }) =>
      createLiveQueryCollection((q) =>
        q
          .from({ issue: issues })
          .where(({ issue }) => eq(issue.id, selectedIssueId))
          .select(({ issue }) => ({
            id: issue.id,
            title: issue.title,
            comments: q
              .from({ comment: comments })
              .where(({ comment }) => eq(comment.issueId, issue.id))
              .orderBy(({ comment }) => comment.createdAt, `desc`)
              .select(({ comment }) => ({
                id: comment.id,
                body: comment.body,
                createdAt: comment.createdAt,
              })),
          })),
      ) as unknown as BenchmarkCollection,
    write: insertSelectedIssueComment,
  },
]

const scales = resolveScales(options)
const results: Array<RunResult> = []
for (const scale of scales) {
  for (const sourceIndexMode of options.sourceIndexModes) {
    const runOptions = createRunOptions(options, scale, sourceIndexMode)
    for (const mutationMode of options.mutationModes) {
      for (const queryCase of queryCases) {
        results.push(await runCase(queryCase, mutationMode, runOptions))
      }
    }
  }
}

const report = {
  metadata: runtimeMetadata(options, scales),
  results,
}

const outputPath =
  options.outFile ??
  join(options.outDir, `incremental-update-${Date.now()}.json`)
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(report, null, 2))

console.log(formatTextReport(report, outputPath))

async function runCase(
  queryCase: QueryCase,
  mutationMode: MutationMode,
  options: BenchmarkRunOptions,
): Promise<RunResult> {
  const fixture = createFixture(options)
  const query = queryCase.createQuery(fixture)

  const coldStart = performance.now()
  await query.preload()
  await flushMicrotasks()
  const coldHydrateMs = performance.now() - coldStart

  for (let i = 0; i < options.warmup; i++) {
    const writeResult = queryCase.write(fixture, i, mutationMode)
    await flushMicrotasks()
    await cleanupWrite(writeResult)
  }

  const samples: Array<number> = []
  for (let i = 0; i < options.iterations; i++) {
    const start = performance.now()
    const writeResult = queryCase.write(
      fixture,
      options.warmup + i,
      mutationMode,
    )
    await flushMicrotasks()
    samples.push(performance.now() - start)
    await cleanupWrite(writeResult)
  }

  await cleanupFixture(fixture, query)

  return {
    query: queryCase.name,
    scenario: queryCase.scenario,
    scale: options.scale,
    sourceIndexMode: options.sourceIndexMode,
    mutationMode,
    coldHydrateMs,
    writeSummary: summarize(samples),
  }
}

function createManualCollection<T extends object, TKey extends string | number>(
  id: string,
  initialData: Array<T>,
  getKey: (item: T) => TKey,
  sourceIndexMode: SourceIndexMode,
): ManualCollection<T, TKey> {
  let begin: Parameters<SyncConfig<T, TKey>[`sync`]>[0][`begin`] | undefined
  let write: Parameters<SyncConfig<T, TKey>[`sync`]>[0][`write`] | undefined
  let commit: Parameters<SyncConfig<T, TKey>[`sync`]>[0][`commit`] | undefined

  const utils: ManualSyncUtils<T, TKey> = {
    begin: (syncOptions) => begin!(syncOptions),
    write: (message) => write!(message),
    commit: () => commit!(),
  }

  return createCollection<T, TKey, ManualSyncUtils<T, TKey>>({
    id,
    getKey,
    utils,
    startSync: true,
    autoIndex: sourceIndexMode === `auto` ? `eager` : `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      rowUpdateMode: `full`,
      sync: (methods) => {
        begin = methods.begin
        write = methods.write
        commit = methods.commit

        begin()
        for (const value of initialData) {
          write({
            type: `insert`,
            value,
          })
        }
        commit()
        methods.markReady()

        return () => {
          begin = undefined
          write = undefined
          commit = undefined
        }
      },
    },
  })
}

function createFixture(options: BenchmarkRunOptions): Fixture {
  const random = seededRandom(options.seed)
  const usersData: Array<User> = []
  for (let id = 1; id <= options.userCount; id++) {
    usersData.push({
      id,
      name: `User ${id}`,
      reputation: Math.floor(random() * 10_000),
    })
  }

  const issuesData: Array<Issue> = []
  for (let id = 1; id <= options.issueCount; id++) {
    issuesData.push({
      id,
      status: id % 3 === 0 ? `closed` : `open`,
      authorId: 1 + (id % options.userCount),
      createdAt: id,
      title: `Issue ${id}`,
      body: `Body ${id}`,
      updateTick: 0,
    })
  }

  const visibleIssueId = findNewestOpenIssueId(issuesData)
  const selectedIssueId = visibleIssueId
  const commentsData: Array<Comment> = []
  for (let id = 1; id <= options.commentCount; id++) {
    const hotIssueId =
      id % 5 === 0
        ? 1 + Math.floor(random() * Math.min(options.issueCount, 50))
        : 1 + Math.floor(random() * options.issueCount)
    commentsData.push({
      id,
      issueId: hotIssueId,
      authorId: 1 + (id % options.userCount),
      createdAt: id,
      body: `Comment ${id}`,
      updateTick: 0,
    })
  }

  const fixture = {
    seed: options.seed,
    issues: createManualCollection(
      `bench-issues`,
      issuesData,
      (issue) => issue.id,
      options.sourceIndexMode,
    ),
    users: createManualCollection(
      `bench-users`,
      usersData,
      (user) => user.id,
      options.sourceIndexMode,
    ),
    comments: createManualCollection(
      `bench-comments`,
      commentsData,
      (comment) => comment.id,
      options.sourceIndexMode,
    ),
    issueById: new Map(issuesData.map((issue) => [issue.id, issue])),
    userById: new Map(usersData.map((user) => [user.id, user])),
    commentById: new Map(commentsData.map((comment) => [comment.id, comment])),
    visibleIssueId,
    selectedIssueId,
    nextCommentId: options.commentCount + 1,
  }

  applySourceIndexes(fixture, options.sourceIndexMode)

  return fixture
}

function applySourceIndexes(
  fixture: Fixture,
  sourceIndexMode: SourceIndexMode,
): void {
  if (sourceIndexMode !== `manual`) return

  fixture.issues.createIndex((issue) => issue.id)
  fixture.issues.createIndex((issue) => issue.status)
  fixture.issues.createIndex((issue) => issue.authorId)
  fixture.issues.createIndex((issue) => issue.createdAt)
  fixture.users.createIndex((user) => user.id)
  fixture.comments.createIndex((comment) => comment.issueId)
  fixture.comments.createIndex((comment) => comment.createdAt)
}

function updateVisibleIssue(
  fixture: Fixture,
  iteration: number,
  mutationMode: MutationMode,
): WriteResult {
  const issue = fixture.issueById.get(fixture.visibleIssueId)!
  const next = {
    ...issue,
    title: `Issue ${issue.id} tick ${iteration}`,
    updateTick: iteration,
  }
  fixture.issueById.set(issue.id, next)

  if (mutationMode === `synced`) {
    writeSync(fixture.issues, {
      type: `update`,
      value: next,
    })
    return
  }

  const transaction = writeOptimistic(() => {
    fixture.issues.update(issue.id, (draft) => {
      draft.title = next.title
      draft.updateTick = next.updateTick
    })
  })

  return {
    cleanup: () => {
      transaction.rollback()
      fixture.issueById.set(issue.id, issue)
    },
  }
}

function updateVisibleAuthor(
  fixture: Fixture,
  iteration: number,
  mutationMode: MutationMode,
): WriteResult {
  const issue = fixture.issueById.get(fixture.visibleIssueId)!
  const user = fixture.userById.get(issue.authorId)!
  const next = {
    ...user,
    name: `User ${user.id} tick ${iteration}`,
    reputation: user.reputation + 1,
  }
  fixture.userById.set(user.id, next)

  if (mutationMode === `synced`) {
    writeSync(fixture.users, {
      type: `update`,
      value: next,
    })
    return
  }

  const transaction = writeOptimistic(() => {
    fixture.users.update(user.id, (draft) => {
      draft.name = next.name
      draft.reputation = next.reputation
    })
  })

  return {
    cleanup: () => {
      transaction.rollback()
      fixture.userById.set(user.id, user)
    },
  }
}

function insertVisibleComment(
  fixture: Fixture,
  iteration: number,
  mutationMode: MutationMode,
): WriteResult {
  return insertCommentForIssue(
    fixture,
    fixture.visibleIssueId,
    iteration,
    mutationMode,
  )
}

function insertSelectedIssueComment(
  fixture: Fixture,
  iteration: number,
  mutationMode: MutationMode,
): WriteResult {
  return insertCommentForIssue(
    fixture,
    fixture.selectedIssueId,
    iteration,
    mutationMode,
  )
}

function insertCommentForIssue(
  fixture: Fixture,
  issueId: number,
  iteration: number,
  mutationMode: MutationMode,
): WriteResult {
  const comment: Comment = {
    id: fixture.nextCommentId++,
    issueId,
    authorId: 1 + (iteration % fixture.userById.size),
    createdAt: 1_000_000_000 + iteration,
    body: `Inserted comment ${iteration}`,
    updateTick: iteration,
  }
  fixture.commentById.set(comment.id, comment)

  if (mutationMode === `synced`) {
    writeSync(fixture.comments, {
      type: `insert`,
      value: comment,
    })
    return
  }

  const transaction = writeOptimistic(() => {
    fixture.comments.insert(comment)
  })

  return {
    cleanup: () => {
      transaction.rollback()
      fixture.commentById.delete(comment.id)
    },
  }
}

function writeSync<T extends object, TKey extends string | number>(
  collection: ManualCollection<T, TKey>,
  message: ChangeMessageOrDeleteKeyMessage<T, TKey>,
): void {
  collection.utils.begin({ immediate: true })
  collection.utils.write(message)
  collection.utils.commit()
}

function writeOptimistic(write: () => void) {
  const transaction = createTransaction({
    autoCommit: false,
    mutationFn: async () => {},
  })
  transaction.isPersisted.promise.catch(() => undefined)
  transaction.mutate(write)
  return transaction
}

async function cleanupWrite(writeResult: WriteResult): Promise<void> {
  if (!writeResult) return
  await writeResult.cleanup()
  await flushMicrotasks()
}

async function cleanupFixture(
  fixture: Fixture,
  query: BenchmarkCollection,
): Promise<void> {
  await Promise.all([
    query.cleanup(),
    fixture.issues.cleanup(),
    fixture.users.cleanup(),
    fixture.comments.cleanup(),
  ])
}

function summarize(samples: Array<number>): Summary {
  const sorted = [...samples].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const mean = total / sorted.length
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length
  return {
    iterations: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p75Ms: percentile(sorted, 0.75),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    stddevMs: Math.sqrt(variance),
  }
}

function percentile(sorted: Array<number>, p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[index]!
}

function runtimeMetadata(
  options: BenchmarkOptions,
  scales: Array<FixtureScale>,
) {
  return {
    seed: options.seed,
    levels: options.levels,
    scales,
    sourceIndexModes: options.sourceIndexModes,
    mutationModes: options.mutationModes,
    warmup: options.warmup,
    iterations: options.iterations,
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? `unknown`,
    gitSha: gitSha(),
    gcAvailable: typeof global.gc === `function`,
  }
}

function formatTextReport(
  report: {
    metadata: ReturnType<typeof runtimeMetadata>
    results: Array<RunResult>
  },
  outputPath: string,
): string {
  const lines: Array<string> = []
  lines.push(`Incremental update benchmark`)
  lines.push(`seed=${report.metadata.seed}`)
  lines.push(`scales=${report.metadata.scales.map(formatScale).join(`; `)}`)
  lines.push(`sourceIndexModes=${report.metadata.sourceIndexModes.join(`,`)}`)
  lines.push(`mutationModes=${report.metadata.mutationModes.join(`,`)}`)
  lines.push(
    `runtime=node ${report.metadata.node} ${report.metadata.platform} ${report.metadata.cpu}`,
  )
  lines.push(`git=${report.metadata.gitSha}`)
  lines.push(`json=${outputPath}`)
  lines.push(``)

  for (const scale of uniqueScales(report.results)) {
    lines.push(`scale=${formatScale(scale)}`)
    for (const sourceIndexMode of report.metadata.sourceIndexModes) {
      lines.push(`sourceIndexMode=${sourceIndexMode}`)
      for (const mutationMode of report.metadata.mutationModes) {
        lines.push(`mutationMode=${mutationMode}`)
        for (const result of report.results.filter(
          (item) =>
            scaleKey(item.scale) === scaleKey(scale) &&
            item.sourceIndexMode === sourceIndexMode &&
            item.mutationMode === mutationMode,
        )) {
          lines.push(`${result.query} | ${result.scenario}`)
          lines.push(
            `  cold=${formatMs(result.coldHydrateMs)} median=${formatMs(
              result.writeSummary.medianMs,
            )} p95=${formatMs(result.writeSummary.p95Ms)} min=${formatMs(
              result.writeSummary.minMs,
            )} max=${formatMs(result.writeSummary.maxMs)} stddev=${formatMs(
              result.writeSummary.stddevMs,
            )}`,
          )
        }
        lines.push(``)
      }
    }
  }

  return lines.join(`\n`)
}

function resolveScales(options: BenchmarkOptions): Array<FixtureScale> {
  const hasCustomScale =
    options.issueCount !== undefined ||
    options.userCount !== undefined ||
    options.commentCount !== undefined

  if (hasCustomScale) {
    return [
      {
        label: `custom`,
        issueCount: options.issueCount ?? defaultCustomScale.issueCount,
        userCount: options.userCount ?? defaultCustomScale.userCount,
        commentCount: options.commentCount ?? defaultCustomScale.commentCount,
      },
    ]
  }

  return options.levels.map((level) => ({
    label: String(level),
    issueCount: level,
    userCount: level,
    commentCount: level,
  }))
}

function createRunOptions(
  options: BenchmarkOptions,
  scale: FixtureScale,
  sourceIndexMode: SourceIndexMode,
): BenchmarkRunOptions {
  return {
    seed: options.seed,
    scale,
    issueCount: scale.issueCount,
    userCount: scale.userCount,
    commentCount: scale.commentCount,
    sourceIndexMode,
    warmup: options.warmup,
    iterations: options.iterations,
  }
}

function uniqueScales(results: Array<RunResult>): Array<FixtureScale> {
  const scales = new Map<string, FixtureScale>()
  for (const result of results) {
    scales.set(scaleKey(result.scale), result.scale)
  }
  return [...scales.values()]
}

function scaleKey(scale: FixtureScale): string {
  return `${scale.label}:${scale.issueCount}:${scale.userCount}:${scale.commentCount}`
}

function formatScale(scale: FixtureScale): string {
  if (
    scale.issueCount === scale.userCount &&
    scale.userCount === scale.commentCount
  ) {
    return `${formatInteger(scale.issueCount)} rows/collection`
  }

  return `issues:${formatInteger(scale.issueCount)} users:${formatInteger(
    scale.userCount,
  )} comments:${formatInteger(scale.commentCount)}`
}

function formatMs(value: number): string {
  return `${formatNumber(value)}ms`
}

function formatNumber(value: number): string {
  return value.toFixed(3)
}

function formatInteger(value: number): string {
  return value.toLocaleString(`en-US`)
}

function parseArgs(
  args: Array<string>,
  defaults: BenchmarkOptions,
): BenchmarkOptions {
  const parsed = {
    ...defaults,
    levels: [...defaults.levels],
    sourceIndexModes: [...defaults.sourceIndexModes],
    mutationModes: [...defaults.mutationModes],
  }

  for (const arg of args) {
    const [name, value] = arg.replace(/^--/, ``).split(`=`)
    if (!name || value === undefined) continue

    switch (name) {
      case `seed`:
        parsed.seed = parseNonNegativeInteger(value, name)
        break
      case `levels`:
        parsed.levels = parseLevels(value)
        break
      case `sourceIndexes`:
      case `sourceIndexModes`:
        parsed.sourceIndexModes = parseSourceIndexModes(value)
        break
      case `mutationModes`:
        parsed.mutationModes = parseMutationModes(value)
        break
      case `issues`:
        parsed.issueCount = parsePositiveCount(value, name)
        break
      case `users`:
        parsed.userCount = parsePositiveCount(value, name)
        break
      case `comments`:
        parsed.commentCount = parsePositiveCount(value, name)
        break
      case `warmup`:
        parsed.warmup = parseNonNegativeInteger(value, name)
        break
      case `iterations`:
        parsed.iterations = parsePositiveInteger(value, name)
        break
      case `outDir`:
        parsed.outDir = value
        break
      case `outFile`:
        parsed.outFile = value
        break
    }
  }

  return parsed
}

function parseLevels(value: string): Array<number> {
  const levels = value
    .split(`,`)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parsePositiveCount(part, `levels`))

  if (levels.length === 0) {
    throw new Error(`--levels must contain at least one positive integer`)
  }

  return levels
}

function parseMutationModes(value: string): Array<MutationMode> {
  const modes = value
    .split(`,`)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (modes.length === 0) {
    throw new Error(`--mutationModes must contain at least one mode`)
  }

  for (const mode of modes) {
    if (mode !== `synced` && mode !== `optimistic`) {
      throw new Error(`--mutationModes must contain synced and/or optimistic`)
    }
  }

  return modes
}

function parseSourceIndexModes(value: string): Array<SourceIndexMode> {
  const modes = value
    .split(`,`)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (modes.length === 0) {
    throw new Error(`--sourceIndexes must contain at least one mode`)
  }

  for (const mode of modes) {
    if (mode !== `none` && mode !== `manual` && mode !== `auto`) {
      throw new Error(`--sourceIndexes must contain none, manual, and/or auto`)
    }
  }

  return modes
}

function parsePositiveCount(value: string, name: string): number {
  const normalized = value.trim().toLowerCase()
  const parsed = normalized.endsWith(`k`)
    ? Number(normalized.slice(0, -1)) * 1_000
    : Number(normalized)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer or k-suffixed count`)
  }
  return parsed
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return parsed
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`)
  }
  return parsed
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
}

function findNewestOpenIssueId(issues: Array<Issue>): number {
  for (let index = issues.length - 1; index >= 0; index--) {
    const issue = issues[index]!
    if (issue.status === `open`) {
      return issue.id
    }
  }
  throw new Error(`Fixture must contain at least one open issue`)
}

function gitSha(): string {
  try {
    return execSync(`git rev-parse --short HEAD`, {
      encoding: `utf8`,
      stdio: [`ignore`, `pipe`, `ignore`],
    }).trim()
  } catch {
    return `unknown`
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
