// A Vitest reporter for the oracleProperty self-oracle. It writes every test's
// state and errors, with their causes (fast-check attaches a property's error
// as the cause of its failure), to the file named by SELF_ORACLE_REPORT.
import { writeFileSync } from 'node:fs'

/**
 * @param {unknown} error
 * @returns {{ name?: string, message?: string, cause?: unknown } | undefined}
 */
const serialize = (error) => {
  if (error === undefined) return undefined
  if (!error || typeof error !== `object`) return { message: String(error) }
  const { name, message, cause } =
    /** @type {{ name?: string, message?: string, cause?: unknown }} */ (error)
  return { name, message, cause: serialize(cause) }
}

export default class SelfOracleReporter {
  /**
   * @param {ReadonlyArray<import('vitest/node').TestModule>} testModules
   * @param {ReadonlyArray<unknown>} unhandledErrors
   */
  onTestRunEnd(testModules, unhandledErrors) {
    const files = testModules.map((module) => ({
      file: module.moduleId,
      errors: (module.errors?.() ?? []).map(serialize),
      tests: [...module.children.allTests()].map((test) => ({
        name: test.fullName,
        state: test.result().state,
        errors: (test.result().errors ?? []).map(serialize),
      })),
    }))
    writeFileSync(
      process.env.SELF_ORACLE_REPORT ?? `self-oracle-report.json`,
      JSON.stringify({
        files,
        unhandled: (unhandledErrors ?? []).map(serialize),
      }),
    )
  }
}
