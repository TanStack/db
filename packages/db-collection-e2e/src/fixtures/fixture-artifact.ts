import type { SeedDataResult } from '../types'

export type FixtureValue =
  | ['null']
  | ['undefined']
  | ['boolean', boolean]
  | ['string', string]
  | ['number' | 'bigint' | 'date', string]
  | ['array', Array<FixtureValue>]
  | ['object', Array<[string, FixtureValue]>]

export interface FixtureDiagnostics {
  registration: string
  provider: string
  emit?: (line: string) => void
}

// A finite fixture format, not a heap serializer. Unsupported extensions must
// not silently become a supposedly complete replay record or change the getter.
function encodeFixture(
  value: unknown,
  seen = new WeakSet<object>(),
): FixtureValue {
  if (value === null) return ['null']
  switch (typeof value) {
    case 'undefined':
      return ['undefined']
    case 'boolean':
      return ['boolean', value]
    case 'string':
      return ['string', value]
    case 'number':
      return ['number', Object.is(value, -0) ? '-0' : String(value)]
    case 'bigint':
      return ['bigint', String(value)]
    case 'object':
      break
    default:
      throw new TypeError('Unsupported fixture value')
  }
  if (seen.has(value)) {
    throw new TypeError('Shared or cyclic fixture reference')
  }
  seen.add(value)
  if (value instanceof Date) return ['date', String(value.getTime())]
  if (Array.isArray(value)) {
    if (
      Reflect.ownKeys(value).length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, index) => index).some(
        (index) => !Object.hasOwn(value, index),
      )
    ) {
      throw new TypeError('Sparse or decorated fixture array')
    }
    return ['array', value.map((item) => encodeFixture(item, seen))]
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Unsupported fixture object')
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError('Symbol fixture property')
  }
  return [
    'object',
    Object.entries(value).map(([key, item]) => [
      key,
      encodeFixture(item, seen),
    ]),
  ]
}

export function reportFixtureCapture(
  fixture: SeedDataResult,
  diagnostics: FixtureDiagnostics,
): void {
  const capturedAt = Date.now()
  let payload:
    | { status: 'complete'; fixture: FixtureValue }
    | { status: 'unsupported'; reason: string }
  try {
    payload = { status: 'complete', fixture: encodeFixture(fixture) }
  } catch (error) {
    payload = {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
  const line =
    '[db-e2e-fixture] ' +
    JSON.stringify({
      version: 1,
      registration: diagnostics.registration,
      provider: diagnostics.provider,
      capturedAt,
      runtime: null,
      providerVersion: null,
      ...payload,
    })
  if (diagnostics.emit) diagnostics.emit(line)
  else console.info(line)
}
