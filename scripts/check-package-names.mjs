import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Public packages live directly under packages/. Nested apps and private test
// fixtures have their own names. See CONTRIBUTING.md, Package names. Probes
// observe the same decisions that validation uses; they decide no diagnostics.
function main() {
  const probing =
    typeof process === 'undefined'
      ? false
      : process.env.NODE_ENV !== 'production'
  let checked = 0
  let errors = 0
  for (const entry of readdirSync(`packages`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(`packages`, entry.name, `package.json`)
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, `utf8`))
    const privatePackage = manifest.private === true
    // A false call marks a reached decision. Only its body records entry.
    probing && globalThis.__oracleProbe?.('package-names#private', false)
    if (privatePackage) {
      probing && globalThis.__oracleProbe?.('package-names#private', true)
      continue
    }
    checked++
    const errorsBefore = errors
    const report = (rule, message) => {
      console.error(`[${rule}] ${file}: ${message}`)
      errors++
    }
    const name = manifest.name
    const missingName = typeof name !== `string` || name.length === 0
    probing && globalThis.__oracleProbe?.('package-names#missing-name', false)
    if (missingName) {
      probing && globalThis.__oracleProbe?.('package-names#missing-name', true)
      report(`name`, `Public packages need a name.`)
    } else {
      const wrongScope = !/^@tanstack\/[^/]+$/.test(name)
      probing && globalThis.__oracleProbe?.('package-names#scope', false)
      if (wrongScope) {
        probing && globalThis.__oracleProbe?.('package-names#scope', true)
        report(`scope`, `Use the @tanstack scope.`)
      }
      const unscoped = name.slice(name.lastIndexOf(`/`) + 1)
      const wrongDirectory = unscoped !== entry.name
      probing && globalThis.__oracleProbe?.('package-names#folder', false)
      if (wrongDirectory) {
        probing && globalThis.__oracleProbe?.('package-names#folder', true)
        report(
          `directory`,
          `Use @tanstack/${entry.name} to match the package directory.`,
        )
      }
      const wrongSpelling = !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(unscoped)
      probing && globalThis.__oracleProbe?.('package-names#kebab', false)
      if (wrongSpelling) {
        probing && globalThis.__oracleProbe?.('package-names#kebab', true)
        report(`kebab`, `Use lowercase words separated by single hyphens.`)
      }
      // offline-transactions predates this convention and keeps its name.
      const offline = unscoped === `offline-transactions`
      probing && globalThis.__oracleProbe?.('package-names#offline', offline)
      const missingDb = !offline && !unscoped.split(`-`).includes(`db`)
      probing && globalThis.__oracleProbe?.('package-names#missing-db', false)
      if (missingDb) {
        probing && globalThis.__oracleProbe?.('package-names#missing-db', true)
        report(`db-segment`, `Include db as a hyphen-separated word.`)
      }
      const wrongSuffix =
        unscoped.endsWith(`-collection`) && !unscoped.endsWith(`-db-collection`)
      probing &&
        globalThis.__oracleProbe?.('package-names#collection-suffix', false)
      if (wrongSuffix) {
        probing &&
          globalThis.__oracleProbe?.('package-names#collection-suffix', true)
        report(
          `collection-suffix`,
          `Collection adapters must end in -db-collection.`,
        )
      }
    }
    probing &&
      globalThis.__oracleProbe?.('package-names#valid', errors === errorsBefore)
    probing &&
      globalThis.__oracleProbe?.(
        'package-names#multiple-invalid-packages',
        errorsBefore > 0 && errors > errorsBefore,
      )
    probing &&
      globalThis.__oracleProbe?.(
        'package-names#combined-faults',
        errors - errorsBefore > 1,
      )
  }
  console.log(`Checked ${checked} public package names.`)
  process.exitCode = errors ? 1 : 0
}

main()
