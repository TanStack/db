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
  status: `passed` | `failed` | `skipped`
  error?: string
}

export type RegisteredTestRunResult = {
  passed: number
  failed: number
  skipped: number
  total: number
  results: Array<TestResult>
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

  if (skipped) {
    return
  }

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

function failExpectation(message: string | undefined, fallback: string): never {
  throw new Error(message ?? fallback)
}

function createMatchers(
  actual: unknown,
  message?: string,
  negate = false,
): Record<string, unknown> {
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
  } as Record<string, unknown>

  return new Proxy(matchers, {
    get(target, propertyKey, receiver) {
      if (propertyKey === `not`) {
        return createMatchers(actual, message, !negate)
      }

      return Reflect.get(target, propertyKey, receiver)
    },
  })
}

export function expect(
  actual: unknown,
  message?: string,
): Record<string, unknown> {
  return createMatchers(actual, message)
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

function countTests(suite: SuiteNode): number {
  return (
    suite.tests.length +
    suite.suites.reduce(
      (count, childSuite) => count + countTests(childSuite),
      0,
    )
  )
}

export function getRegisteredTestCount(): number {
  return countTests(rootSuite)
}

async function runHookList(
  hooks: ReadonlyArray<AsyncCallback>,
  label: string,
  results: Array<TestResult>,
): Promise<boolean> {
  for (const hook of hooks) {
    try {
      await hook()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        name: label,
        status: `failed`,
        error: message,
      })
      return false
    }
  }

  return true
}

async function runSuite(
  suite: SuiteNode,
  ancestors: Array<SuiteNode>,
  results: Array<TestResult>,
  state: {
    index: number
    total: number
  },
  options: {
    onTestStart?: (context: {
      name: string
      index: number
      total: number
    }) => void
  },
): Promise<void> {
  if (suite.skipped) {
    return
  }

  const suitePath = [...ancestors, suite]
  const beforeAllSucceeded = await runHookList(
    suite.beforeAllHooks,
    `${formatSuitePath(suitePath)} beforeAll`,
    results,
  )

  if (beforeAllSucceeded) {
    for (const testNode of suite.tests) {
      const testName = formatSuitePath(suitePath, testNode.name)
      state.index++

      if (testNode.skipped) {
        results.push({
          name: testName,
          status: `skipped`,
        })
        continue
      }

      options.onTestStart?.({
        name: testName,
        index: state.index,
        total: state.total,
      })

      try {
        for (const entry of suitePath) {
          for (const hook of entry.beforeEachHooks) {
            await hook()
          }
        }

        await testNode.fn()
        results.push({
          name: testName,
          status: `passed`,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          name: testName,
          status: `failed`,
          error: message,
        })
      } finally {
        for (const entry of [...suitePath].reverse()) {
          for (const hook of entry.afterEachHooks) {
            try {
              await hook()
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error)
              results.push({
                name: `${testName} afterEach`,
                status: `failed`,
                error: message,
              })
            }
          }
        }
      }
    }

    for (const childSuite of suite.suites) {
      await runSuite(childSuite, suitePath, results, state, options)
    }
  }

  await runHookList(
    suite.afterAllHooks,
    `${formatSuitePath(suitePath)} afterAll`,
    results,
  )
}

export async function runRegisteredTests(
  options: {
    onTestStart?: (context: {
      name: string
      index: number
      total: number
    }) => void
  } = {},
): Promise<RegisteredTestRunResult> {
  const results: Array<TestResult> = []
  const state = {
    index: 0,
    total: getRegisteredTestCount(),
  }

  await runSuite(rootSuite, [], results, state, options)

  const passed = results.filter((result) => result.status === `passed`).length
  const failed = results.filter((result) => result.status === `failed`).length
  const skipped = results.filter((result) => result.status === `skipped`).length

  return {
    passed,
    failed,
    skipped,
    total: results.length,
    results,
  }
}
