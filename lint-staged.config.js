// ESLint ran out of memory on a commit of more than about 100 files, so
// staged files are linted in chunks, one ESLint process each. lint-staged
// splits each command without a shell or escape sequences, so plain double
// quotes keep Windows backslashes intact.
const chunkSize = 40

export default {
  // The oracle rules, without inline directives. The script lints the oracle
  // files that each staged test or support module affects, so every module
  // that an oracle can import is passed. It selects the oracle files itself.
  '*.{ts,tsx,js,mjs}': (files) => {
    const commands = []
    for (let start = 0; start < files.length; start += chunkSize) {
      const chunk = files.slice(start, start + chunkSize)
      commands.push(
        `node scripts/agent-lint-feedback.mjs ${chunk.map((file) => `"${file}"`).join(` `)}`,
      )
    }
    return commands
  },
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
