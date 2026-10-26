// ESLint ran out of memory on a commit of more than about 100 files, so
// staged files are linted in chunks, one ESLint process each. lint-staged
// splits each command without a shell or escape sequences, so plain double
// quotes keep Windows backslashes intact.
const chunkSize = 40

export default {
  // The oracle rules, without inline directives. lint-staged appends the
  // staged oracle files as arguments.
  '*oracle*.{ts,tsx}': `node scripts/agent-lint-feedback.mjs`,
  '*.{ts,tsx}': (files) => {
    const commands = []
    for (let start = 0; start < files.length; start += chunkSize) {
      const chunk = files.slice(start, start + chunkSize)
      commands.push(
        `eslint --fix ${chunk.map((file) => `"${file}"`).join(` `)}`,
      )
    }
    return commands
  },
}
