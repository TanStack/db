import noDisabled from './rules/no-disabled.js'
import noUnitTest from './rules/no-unit-test.js'

/**
 * Lint rules for oracle files.
 *
 * AGENTS.md lists the shortcuts that make an oracle pass without enforcing
 * its law ("How oracle work is scored"). These rules report the ones that a
 * syntactic check can see, in files whose names contain `oracle`. They need no
 * type information, so an agent's post-edit hook can run them on one file in
 * well under a second. A directive can silence them in the root config, so
 * scripts/agent-lint-feedback.mjs enforces them in a pass that ignores inline
 * directives.
 */

const oracleFiles = [`**/*oracle*.ts`, `**/*oracle*.tsx`]

const plugin = {
  meta: { name: `eslint-plugin-oracle` },
  rules: {
    'no-disabled': noDisabled,
    'no-unit-test': noUnitTest,
  },
}

plugin.configs = {
  recommended: {
    name: `oracle/recommended`,
    files: oracleFiles,
    plugins: { oracle: plugin },
    rules: {
      'oracle/no-disabled': `error`,
      'oracle/no-unit-test': `error`,
    },
  },
}

export default plugin
