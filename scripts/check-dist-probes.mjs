// Fails when a package's built JavaScript still carries an oracle state probe,
// or, in a package that wires scripts/strip-oracle-probes.mjs, a surviving guard
// (`process.env.NODE_ENV`). scripts/strip-oracle-probes.mjs removes the probes
// and guards from each package build that wires it; this check also catches a
// package whose sources gain a probe without that plugin. An unwired package
// may read `process.env.NODE_ENV` for its own reasons, so the guard check does
// not apply to it. Run it after `pnpm run build`, before anything publishes the
// packages (maintainer decision, 2026-11-09).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packages = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `../packages`,
)
// A package wires the plugin when its vite config names it.
const wiresPlugin = (name) => {
  const config = path.join(packages, name, `vite.config.ts`)
  return (
    existsSync(config) &&
    readFileSync(config, `utf8`).includes(`stripOracleProbes`)
  )
}
const carriers = readdirSync(packages).flatMap((name) => {
  const dist = path.join(packages, name, `dist`)
  let files
  try {
    files = readdirSync(dist, { recursive: true })
  } catch (error) {
    if (error.code === `ENOENT`) return []
    throw error
  }
  const guardCheck = wiresPlugin(name)
  return files
    .filter((file) => /\.[cm]?js$/.test(file))
    .map((file) => path.join(dist, file))
    .filter((file) => {
      const text = readFileSync(file, `utf8`)
      return (
        text.includes(`__oracleProbe`) ||
        (guardCheck && text.includes(`process.env.NODE_ENV`))
      )
    })
})
if (carriers.length > 0) {
  console.error(
    `These built files carry oracle state probes, or a guard that the plugin should have removed (process.env.NODE_ENV in a package that wires stripOracleProbes()). Add stripOracleProbes() from scripts/strip-oracle-probes.mjs to the package's vite.config.ts, or remove the probe:\n${carriers
      .map((file) => `  ${path.relative(process.cwd(), file)}`)
      .join(`\n`)}`,
  )
  process.exit(1)
}
console.log(`No built package file carries an oracle state probe.`)
