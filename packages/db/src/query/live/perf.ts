type PerfTagValue = string | number | boolean | undefined
type PerfTags = Record<string, PerfTagValue>

type PerfMetricKind = `span` | `counter` | `gauge`

interface PerfMetric {
  name: string
  kind: PerfMetricKind
  tags: PerfTags
  calls: number
  total: number
  max: number
  min: number
  last: number
}

interface PerfState {
  enabled: boolean
  metrics: Map<string, PerfMetric>
}

export interface PerfMetricSnapshot {
  name: string
  kind: PerfMetricKind
  tags: PerfTags
  calls: number
  total: number
  max: number
  min: number
  last: number
}

export interface PerfTraceSnapshot {
  enabled: boolean
  metrics: Array<PerfMetricSnapshot>
}

export interface PerfSpanHandle {
  end: (extraTags?: PerfTags) => void
}

const perfStateSymbol = Symbol.for(`@tanstack/db.perfState`)

type PerfGlobal = typeof globalThis & {
  __TANSTACK_DB_TRACE__?: boolean
  [perfStateSymbol]?: PerfState
}

function getPerfState(): PerfState {
  const global = globalThis as PerfGlobal
  global[perfStateSymbol] ??= {
    enabled: readDefaultEnabled(global),
    metrics: new Map(),
  }
  return global[perfStateSymbol]
}

function readDefaultEnabled(global: PerfGlobal): boolean {
  const env = (
    global as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env

  return (
    global.__TANSTACK_DB_TRACE__ === true ||
    env?.TANSTACK_DB_TRACE === `1` ||
    env?.TANSTACK_DB_TRACE === `true`
  )
}

function now(): number {
  return globalThis.performance.now()
}

function metricKey(name: string, kind: PerfMetricKind, tags: PerfTags): string {
  const tagParts = Object.keys(tags)
    .sort()
    .map((key) => `${key}:${String(tags[key])}`)
    .join(`,`)
  return `${kind}:${name}:${tagParts}`
}

function mergedTags(tags: PerfTags, extraTags?: PerfTags): PerfTags {
  return extraTags ? { ...tags, ...extraTags } : tags
}

function recordMetric(
  kind: PerfMetricKind,
  name: string,
  value: number,
  tags: PerfTags = {},
): void {
  const state = getPerfState()
  if (!state.enabled) return

  const key = metricKey(name, kind, tags)
  let metric = state.metrics.get(key)
  if (!metric) {
    metric = {
      name,
      kind,
      tags: { ...tags },
      calls: 0,
      total: 0,
      max: Number.NEGATIVE_INFINITY,
      min: Number.POSITIVE_INFINITY,
      last: 0,
    }
    state.metrics.set(key, metric)
  }

  metric.calls++
  metric.total += value
  metric.max = Math.max(metric.max, value)
  metric.min = Math.min(metric.min, value)
  metric.last = value
}

export function isPerfEnabled(): boolean {
  return getPerfState().enabled
}

export function setPerfTracingEnabled(enabled: boolean): void {
  getPerfState().enabled = enabled
}

export function resetPerfTrace(): void {
  getPerfState().metrics.clear()
}

export function getPerfTraceSnapshot(): PerfTraceSnapshot {
  const state = getPerfState()
  const metrics = Array.from(state.metrics.values())
    .map((metric) => ({
      ...metric,
      tags: { ...metric.tags },
      min: metric.min === Number.POSITIVE_INFINITY ? 0 : metric.min,
      max: metric.max === Number.NEGATIVE_INFINITY ? 0 : metric.max,
    }))
    .sort((a, b) => b.total - a.total || b.calls - a.calls)

  return {
    enabled: state.enabled,
    metrics,
  }
}

export function recordPerfCount(
  name: string,
  value = 1,
  tags?: PerfTags,
): void {
  recordMetric(`counter`, name, value, tags)
}

export function recordPerfGauge(
  name: string,
  value: number,
  tags?: PerfTags,
): void {
  recordMetric(`gauge`, name, value, tags)
}

export function recordPerfSpan(
  name: string,
  durationMs: number,
  tags?: PerfTags,
): void {
  recordMetric(`span`, name, durationMs, tags)
}

export function startPerfSpan(
  name: string,
  tags: PerfTags = {},
): PerfSpanHandle {
  if (!isPerfEnabled()) {
    return { end: () => {} }
  }

  const start = now()
  return {
    end: (extraTags?: PerfTags) => {
      recordPerfSpan(name, now() - start, mergedTags(tags, extraTags))
    },
  }
}

export function withPerfSpan<T>(name: string, tags: PerfTags, fn: () => T): T {
  if (!isPerfEnabled()) {
    return fn()
  }

  const span = startPerfSpan(name, tags)
  try {
    return fn()
  } finally {
    span.end()
  }
}

export async function withPerfSpanAsync<T>(
  name: string,
  tags: PerfTags,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isPerfEnabled()) {
    return fn()
  }

  const span = startPerfSpan(name, tags)
  try {
    return await fn()
  } finally {
    span.end()
  }
}
