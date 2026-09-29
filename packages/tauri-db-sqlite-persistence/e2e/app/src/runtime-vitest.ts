type AsyncCallback = () => void | Promise<void>

type TestNode = {
  name: string
  fn: AsyncCallback
  skipped: boolean
}

type SuiteNode = {
  name: string
  suites: Array<SuiteNode>
  tests: Array<TestNode>
  beforeAllHooks: Array<AsyncCallback>
  afterAllHooks: Array<AsyncCallback>
  beforeEachHooks: Array<AsyncCallback>
  afterEachHooks: Array<AsyncCallback>
  skipped: boolean
}

type TestResult = {
  name: string
  kind: `test` | `hook`
  status: `passed` | `failed` | `skipped` | `unexecuted`
  executed: boolean
  error?: string
}

export type RegisteredTestRunResult = {
  passed: number
  failed: number
  skipped: number
  total: number
  results: Array<TestResult>
  complete: boolean
  expected: number
  registered: number
  executed: number
  unexecuted: number
  expectedNames: Array<string>
  registeredNames: Array<string>
  executedNames: Array<string>
  skippedNames: Array<string>
  unexecutedNames: Array<string>
  missingNames: Array<string>
  unexpectedNames: Array<string>
  duplicateNames: Array<string>
  manifestErrors: Array<string>
}

type NativeMatchers = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
  toStrictEqual: (expected: unknown) => void
  toThrow: () => void
  toBeGreaterThan: (expected: number) => void
  toBeGreaterThanOrEqual: (expected: number) => void
  toBeLessThan: (expected: number) => void
  toBeLessThanOrEqual: (expected: number) => void
  toBeTruthy: () => void
  toBeDefined: () => void
  toBeNull: () => void
  toContain: (expected: unknown) => void
  toHaveProperty: (propertyKey: string) => void
  toHaveLength: (expected: number) => void
  not: NativeMatchers
}

function createSuite(name: string, skipped = false): SuiteNode {
  return {
    name,
    suites: [],
    tests: [],
    beforeAllHooks: [],
    afterAllHooks: [],
    beforeEachHooks: [],
    afterEachHooks: [],
    skipped,
  }
}

const rootSuite = createSuite(``)
function formatSuitePath(
  suites: ReadonlyArray<SuiteNode>,
  leafName?: string,
): string {
  const segments = suites
    .map((suite) => suite.name)
    .filter((name) => name.length > 0)
  if (leafName && leafName.length > 0) {
    segments.push(leafName)
  }

  return segments.join(` > `)
}

let suiteStack: Array<SuiteNode> = [rootSuite]

function currentSuite(): SuiteNode {
  return suiteStack[suiteStack.length - 1] ?? rootSuite
}

function pushSuite(
  name: string,
  skipped: boolean,
  callback: AsyncCallback,
): void {
  const suite = createSuite(name, skipped)
  currentSuite().suites.push(suite)

  // Collect skipped declarations too; their test bodies and hooks never run.
  suiteStack.push(suite)
  try {
    callback()
  } finally {
    suiteStack.pop()
  }
}

function registerHook(
  key:
    | `beforeAllHooks`
    | `afterAllHooks`
    | `beforeEachHooks`
    | `afterEachHooks`,
  callback: AsyncCallback,
): void {
  currentSuite()[key].push(callback)
}

function resolveTestCallback(
  callbackOrOptions: AsyncCallback | Record<string, unknown>,
  maybeCallback?: AsyncCallback,
): AsyncCallback {
  if (typeof callbackOrOptions === `function`) {
    return callbackOrOptions
  }

  if (typeof maybeCallback === `function`) {
    return maybeCallback
  }

  throw new Error(`Test callback must be a function`)
}

function registerTest(
  name: string,
  callback: AsyncCallback,
  skipped: boolean,
): void {
  currentSuite().tests.push({
    name,
    fn: callback,
    skipped,
  })
}

function formatValue(value: unknown): string {
  if (typeof value === `string`) {
    return value
  }

  return JSON.stringify(
    value,
    (_, nestedValue) =>
      typeof nestedValue === `bigint`
        ? { __type: `bigint`, value: nestedValue.toString() }
        : nestedValue,
    2,
  )
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    )
  }

  if (isObjectLike(left) && isObjectLike(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          deepEqual(left[key], right[key]),
      )
    )
  }

  return false
}

// The shared native fixture uses primitives, Dates, arrays and plain metadata.
// Keep own-key/hole/kind distinctions; do not silently treat other objects as {}.
function strictEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      Object.is(left.getTime(), right.getTime())
    )
  }
  if (!isObjectLike(left) || !isObjectLike(right)) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length !== right.length
  )
    return false
  const prototype = Object.getPrototypeOf(left)
  if (
    prototype !== Object.prototype &&
    prototype !== null &&
    prototype !== Array.prototype
  )
    throw new Error('Unsupported object kind in native strict matcher')
  const keys = (value: object) =>
    Reflect.ownKeys(value).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(value, key),
    )
  const leftKeys = keys(left)
  const rightKeys = keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.propertyIsEnumerable.call(right, key) &&
        strictEqual(Reflect.get(left, key), Reflect.get(right, key)),
    )
  )
}

function failExpectation(message: string | undefined, fallback: string): never {
  throw new Error(message ?? fallback)
}

function createMatchers(
  actual: unknown,
  message?: string,
  negate = false,
): NativeMatchers {
  const assert = (condition: boolean, failureMessage: string): void => {
    const shouldFail = negate ? condition : !condition
    if (shouldFail) {
      failExpectation(message, failureMessage)
    }
  }

  const matchers = {
    toBe(expected: unknown) {
      assert(
        Object.is(actual, expected),
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be ${formatValue(expected)}`,
      )
    },
    toEqual(expected: unknown) {
      assert(
        deepEqual(actual, expected),
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to equal ${formatValue(expected)}`,
      )
    },
    toStrictEqual(expected: unknown) {
      assert(
        strictEqual(actual, expected),
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to strictly equal ${formatValue(expected)}`,
      )
    },
    toThrow(...args: Array<unknown>) {
      if (args.length > 0)
        throw new Error('Native toThrow supports no-argument assertions only')
      if (typeof actual !== 'function')
        throw new Error('toThrow requires a synchronous function')
      let threw = false
      let result: unknown
      try {
        result = actual()
      } catch {
        threw = true
      }
      if (
        !threw &&
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof Reflect.get(result, 'then') === 'function'
      ) {
        void Promise.resolve(result).catch(() => {})
        throw new Error('Native toThrow does not support async functions')
      }
      assert(threw, `Expected function ${negate ? `not ` : ``}to throw`)
    },
    toBeGreaterThan(expected: number) {
      assert(
        typeof actual === `number` && actual > expected,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be greater than ${String(expected)}`,
      )
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert(
        typeof actual === `number` && actual >= expected,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be greater than or equal to ${String(expected)}`,
      )
    },
    toBeLessThan(expected: number) {
      assert(
        typeof actual === `number` && actual < expected,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be less than ${String(expected)}`,
      )
    },
    toBeLessThanOrEqual(expected: number) {
      assert(
        typeof actual === `number` && actual <= expected,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be less than or equal to ${String(expected)}`,
      )
    },
    toBeTruthy() {
      assert(
        Boolean(actual),
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be truthy`,
      )
    },
    toBeDefined() {
      assert(
        actual !== undefined,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be defined`,
      )
    },
    toBeNull() {
      assert(
        actual === null,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to be null`,
      )
    },
    toContain(expected: unknown) {
      const contains =
        typeof actual === `string`
          ? actual.includes(String(expected))
          : Array.isArray(actual)
            ? actual.some((entry) => deepEqual(entry, expected))
            : false

      assert(
        contains,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to contain ${formatValue(expected)}`,
      )
    },
    toHaveProperty(propertyKey: string) {
      const hasProperty =
        isObjectLike(actual) &&
        Object.prototype.hasOwnProperty.call(actual, propertyKey)

      assert(
        hasProperty,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to have property ${propertyKey}`,
      )
    },
    toHaveLength(expected: number) {
      const actualLength =
        typeof actual === `string` || Array.isArray(actual)
          ? actual.length
          : undefined

      assert(
        actualLength === expected,
        `Expected ${formatValue(actual)} ${negate ? `not ` : ``}to have length ${String(expected)}`,
      )
    },
  } satisfies Omit<NativeMatchers, 'not'>

  return new Proxy(matchers, {
    get(target, propertyKey, receiver) {
      if (propertyKey === `not`) {
        return createMatchers(actual, message, !negate)
      }

      return Reflect.get(target, propertyKey, receiver)
    },
  }) as NativeMatchers
}

export function expect(actual: unknown, message?: string): NativeMatchers {
  return createMatchers(actual, message)
}

export const vi = {
  async waitFor<T>(
    callback: () => T,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<T> {
    if (
      typeof callback !== 'function' ||
      !isObjectLike(options) ||
      Array.isArray(options)
    )
      throw new Error(
        'Native waitFor requires a callback and an options object',
      )
    if (
      Object.keys(options).some(
        (key) => key !== 'timeout' && key !== 'interval',
      )
    )
      throw new Error('Unsupported native waitFor option')
    const timeout = options.timeout ?? 1000
    const interval = options.interval ?? 50
    if (
      !Number.isFinite(timeout) ||
      timeout < 0 ||
      !Number.isFinite(interval) ||
      interval <= 0
    )
      throw new Error('Invalid native waitFor timeout or interval')
    const started = Date.now()
    for (;;) {
      let result: T
      try {
        result = callback()
      } catch (error) {
        const remaining = timeout - (Date.now() - started)
        if (remaining <= 0) throw error
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(interval, remaining)),
        )
        continue
      }
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof Reflect.get(result, 'then') === 'function'
      ) {
        void Promise.resolve(result).catch(() => {})
        throw new Error(
          'Native waitFor supports synchronous assertion callbacks only',
        )
      }
      return result
    }
  },
}

type Describe = ((name: string, callback: AsyncCallback) => void) & {
  skip: (name: string, callback: AsyncCallback) => void
}

type It = ((
  name: string,
  callbackOrOptions: AsyncCallback | Record<string, unknown>,
  maybeCallback?: AsyncCallback,
) => void) & {
  skip: (
    name: string,
    callbackOrOptions: AsyncCallback | Record<string, unknown>,
    maybeCallback?: AsyncCallback,
  ) => void
}

export const describe: Describe = Object.assign(
  (name: string, callback: AsyncCallback) => {
    pushSuite(name, false, callback)
  },
  {
    skip: (name: string, callback: AsyncCallback) => {
      pushSuite(name, true, callback)
    },
  },
)

export const it: It = Object.assign(
  (
    name: string,
    callbackOrOptions: AsyncCallback | Record<string, unknown>,
    maybeCallback?: AsyncCallback,
  ) => {
    registerTest(
      name,
      resolveTestCallback(callbackOrOptions, maybeCallback),
      false,
    )
  },
  {
    skip: (
      name: string,
      callbackOrOptions: AsyncCallback | Record<string, unknown>,
      maybeCallback?: AsyncCallback,
    ) => {
      registerTest(
        name,
        resolveTestCallback(callbackOrOptions, maybeCallback),
        true,
      )
    },
  },
)

export const test = it

export function beforeAll(callback: AsyncCallback): void {
  registerHook(`beforeAllHooks`, callback)
}

export function afterAll(callback: AsyncCallback): void {
  registerHook(`afterAllHooks`, callback)
}

export function beforeEach(callback: AsyncCallback): void {
  registerHook(`beforeEachHooks`, callback)
}

export function afterEach(callback: AsyncCallback): void {
  registerHook(`afterEachHooks`, callback)
}

export function resetRegisteredTests(): void {
  rootSuite.suites = []
  rootSuite.tests = []
  rootSuite.beforeAllHooks = []
  rootSuite.afterAllHooks = []
  rootSuite.beforeEachHooks = []
  rootSuite.afterEachHooks = []
  suiteStack = [rootSuite]
}

function collectTests(
  suite: SuiteNode,
  ancestors: Array<SuiteNode> = [],
  inheritedSkip = false,
): Array<{ name: string; skipped: boolean }> {
  const path = [...ancestors, suite]
  const skipped = inheritedSkip || suite.skipped
  return [
    ...suite.tests.map((testNode) => ({
      name: formatSuitePath(path, testNode.name),
      skipped: skipped || testNode.skipped,
    })),
    ...suite.suites.flatMap((child) => collectTests(child, path, skipped)),
  ]
}

export function getRegisteredTestNames(): Array<string> {
  return collectTests(rootSuite).map((testNode) => testNode.name)
}

export function getRegisteredTestCount(): number {
  return getRegisteredTestNames().length
}

function recordUnexecuted(
  suite: SuiteNode,
  ancestors: Array<SuiteNode>,
  results: Array<TestResult>,
): void {
  for (const testNode of collectTests(suite, ancestors)) {
    results.push({
      name: testNode.name,
      kind: 'test',
      status: testNode.skipped ? 'skipped' : 'unexecuted',
      executed: false,
    })
  }
}

async function runHookList(
  hooks: ReadonlyArray<AsyncCallback>,
  label: string,
  results: Array<TestResult>,
  stopOnFailure: boolean,
): Promise<boolean> {
  let succeeded = true
  for (const [index, hook] of hooks.entries()) {
    try {
      await hook()
    } catch (error) {
      succeeded = false
      results.push({
        name: `${label} [${index + 1}]`,
        kind: 'hook',
        status: 'failed',
        executed: false,
        error: error instanceof Error ? error.message : String(error),
      })
      if (stopOnFailure) break
    }
  }
  return succeeded
}

type RunOptions = {
  expectedTestNames: ReadonlyArray<string>
  onTestStart?: (context: {
    name: string
    index: number
    total: number
  }) => void
}

async function runSuite(
  suite: SuiteNode,
  ancestors: Array<SuiteNode>,
  results: Array<TestResult>,
  state: { index: number; total: number },
  options: RunOptions,
): Promise<void> {
  if (suite.skipped) {
    recordUnexecuted(suite, ancestors, results)
    return
  }
  const path = [...ancestors, suite]
  const started = await runHookList(
    suite.beforeAllHooks,
    `${formatSuitePath(path)} beforeAll`,
    results,
    true,
  )
  if (!started) {
    recordUnexecuted(suite, ancestors, results)
  } else {
    for (const testNode of suite.tests) {
      const name = formatSuitePath(path, testNode.name)
      state.index++
      if (testNode.skipped) {
        results.push({ name, kind: 'test', status: 'skipped', executed: false })
        continue
      }
      let ready = true
      try {
        try {
          options.onTestStart?.({
            name,
            index: state.index,
            total: state.total,
          })
        } catch (error) {
          ready = false
          results.push({
            name: `${name} onTestStart`,
            kind: 'hook',
            status: 'failed',
            executed: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        if (ready) {
          for (const entry of path) {
            ready = await runHookList(
              entry.beforeEachHooks,
              `${name} beforeEach (${formatSuitePath(path.slice(0, path.indexOf(entry) + 1))})`,
              results,
              true,
            )
            if (!ready) break
          }
        }
        if (!ready) {
          results.push({
            name,
            kind: 'test',
            status: 'unexecuted',
            executed: false,
          })
        } else {
          try {
            await testNode.fn()
            results.push({
              name,
              kind: 'test',
              status: 'passed',
              executed: true,
            })
          } catch (error) {
            results.push({
              name,
              kind: 'test',
              status: 'failed',
              executed: true,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      } finally {
        for (const entry of [...path].reverse()) {
          await runHookList(
            entry.afterEachHooks,
            `${name} afterEach (${formatSuitePath(path.slice(0, path.indexOf(entry) + 1))})`,
            results,
            false,
          )
        }
      }
    }
    for (const child of suite.suites)
      await runSuite(child, path, results, state, options)
  }
  await runHookList(
    suite.afterAllHooks,
    `${formatSuitePath(path)} afterAll`,
    results,
    false,
  )
}

function duplicates(names: ReadonlyArray<string>): Array<string> {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) repeated.add(name)
    seen.add(name)
  }
  return [...repeated]
}

export async function runRegisteredTests(
  options: RunOptions,
): Promise<RegisteredTestRunResult> {
  const expectedNames = [...options.expectedTestNames]
  const initialNames = getRegisteredTestNames()
  const results: Array<TestResult> = []
  await runSuite(
    rootSuite,
    [],
    results,
    { index: 0, total: initialNames.length },
    options,
  )
  const registeredNames = getRegisteredTestNames()
  const tests = results.filter((result) => result.kind === 'test')
  const executedNames = tests
    .filter((result) => result.executed)
    .map((result) => result.name)
  const skippedNames = tests
    .filter((result) => result.status === 'skipped')
    .map((result) => result.name)
  const unexecutedNames = tests
    .filter((result) => result.status === 'unexecuted')
    .map((result) => result.name)
  const expectedSet = new Set(expectedNames)
  const registeredSet = new Set(registeredNames)
  const executedSet = new Set(executedNames)
  const missingNames = expectedNames.filter((name) => !registeredSet.has(name))
  const unexpectedNames = registeredNames.filter(
    (name) => !expectedSet.has(name),
  )
  const duplicateNames = duplicates(registeredNames)
  const manifestErrors: Array<string> = []
  if (expectedNames.length === 0)
    manifestErrors.push('Expected law manifest is empty')
  if (
    expectedNames.some(
      (name) => typeof name !== 'string' || name.trim().length === 0,
    )
  )
    manifestErrors.push('Expected law manifest has an invalid name')
  if (duplicates(expectedNames).length > 0)
    manifestErrors.push('Expected law manifest has duplicate names')
  if (missingNames.length > 0)
    manifestErrors.push('Required laws are not registered')
  if (unexpectedNames.length > 0)
    manifestErrors.push('Unexpected laws are registered')
  if (duplicateNames.length > 0)
    manifestErrors.push('Law registration has duplicate names')
  if (
    expectedNames.some((name) => !executedSet.has(name)) ||
    executedNames.length !== expectedNames.length ||
    duplicates(executedNames).length > 0
  )
    manifestErrors.push(
      'Required law bodies were not each executed exactly once',
    )
  if (skippedNames.length > 0 || unexecutedNames.length > 0)
    manifestErrors.push('Registered laws were skipped or unexecuted')
  if (
    initialNames.length !== registeredNames.length ||
    initialNames.some((name, index) => name !== registeredNames[index])
  )
    manifestErrors.push('Law registration changed during execution')
  return {
    passed: tests.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: skippedNames.length,
    total: registeredNames.length,
    results,
    complete: manifestErrors.length === 0,
    expected: expectedNames.length,
    registered: registeredNames.length,
    executed: executedNames.length,
    unexecuted: unexecutedNames.length,
    expectedNames,
    registeredNames,
    executedNames,
    skippedNames,
    unexecutedNames,
    missingNames,
    unexpectedNames,
    duplicateNames,
    manifestErrors,
  }
}
