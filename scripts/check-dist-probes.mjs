// Fails when a package's built JavaScript still carries an oracle state probe.
// scripts/strip-oracle-probes.mjs removes the probes from each package build
// that wires it; this check also catches a package whose sources gain a probe
// without that plugin. Run it after `pnpm run build`, before anything
// publishes the packages (maintainer decision, 2026-11-09).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packages = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `../packages`,
)
const carriers = readdirSync(packages).flatMap((name) => {
  const dist = path.join(packages, name, `dist`)
  let files
  try {
    files = readdirSync(dist, { recursive: true })
  } catch (error) {
    if (error.code === `ENOENT`) return []
    throw error
  }
  return files
    .filter((file) => /\.[cm]?js$/.test(file))
    .map((file) => path.join(dist, file))
    .filter((file) => readFileSync(file, `utf8`).includes(`__oracleProbe`))
})
if (carriers.length > 0) {
  console.error(
    `These built files carry oracle state probes. Add stripOracleProbes() from scripts/strip-oracle-probes.mjs to the package's vite.config.ts:\n${carriers
      .map((file) => `  ${path.relative(process.cwd(), file)}`)
      .join(`\n`)}`,
  )
  process.exit(1)
}
console.log(`No built package file carries an oracle state probe.`)
