/**
 * This script updates @tanstack/* dependencies in example packages
 * to match the current versions in packages/*.
 *
 * It runs as part of `changeset:version` so that the "Version Packages" PR
 * includes example dependency updates alongside package version bumps.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL(`.`, import.meta.url))
const rootDir = resolve(__dirname, `..`)

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

// Build a map of @tanstack package names to their current versions
function getPackageVersions(): Map<string, string> {
  const packagesDir = join(rootDir, `packages`)
  const versions = new Map<string, string>()

  for (const dir of readdirSync(packagesDir)) {
    const packageJsonPath = join(packagesDir, dir, `package.json`)
    try {
      const stat = statSync(packageJsonPath)
      if (!stat.isFile()) continue
    } catch {
      continue
    }

    try {
      const packageJson: PackageJson = JSON.parse(
        readFileSync(packageJsonPath, `utf-8`),
      )
      // Only include packages that have a name, version, and are @tanstack scoped
      if (
        packageJson.name.startsWith(`@tanstack/`) &&
        packageJson.version &&
        !packageJson.name.includes(`e2e`) // Skip e2e test packages
      ) {
        versions.set(packageJson.name, packageJson.version)
      }
    } catch {
      console.warn(`Warning: Could not parse ${packageJsonPath}`)
    }
  }

  return versions
}

// Find all package.json files in examples directory recursively
function findExamplePackageJsons(dir: string): Array<string> {
  const results: Array<string> = []

  // Directories to skip (build artifacts, dependencies, etc.)
  const skipDirs = new Set([
    `node_modules`,
    `.output`,
    `dist`,
    `build`,
    `.next`,
    `.nuxt`,
  ])

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)

    if (skipDirs.has(entry)) continue

    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        results.push(...findExamplePackageJsons(fullPath))
      } else if (entry === `package.json`) {
        results.push(fullPath)
      }
    } catch {
      // Skip files we can't stat
    }
  }

  return results
}

// Update dependencies in a package.json file
function updateDependencies(
  deps: Record<string, string> | undefined,
  versions: Map<string, string>,
): { updated: boolean; deps: Record<string, string> | undefined } {
  if (!deps) return { updated: false, deps }

  let updated = false
  const newDeps = { ...deps }

  for (const [name, currentVersion] of Object.entries(deps)) {
    if (name.startsWith(`@tanstack/`) && versions.has(name)) {
      const newVersion = `^${versions.get(name)}`
      if (currentVersion !== newVersion) {
        newDeps[name] = newVersion
        updated = true
      }
    }
  }

  return { updated, deps: newDeps }
}

function main() {
  console.log(`\n📦 Updating example dependencies...\n`)

  const versions = getPackageVersions()
  console.log(`Found ${versions.size} @tanstack packages:`)
  for (const [name, version] of versions) {
    console.log(`  ${name}: ${version}`)
  }
  console.log()

  const examplesDir = join(rootDir, `examples`)
  const examplePackageJsons = findExamplePackageJsons(examplesDir)

  let totalUpdated = 0

  for (const packageJsonPath of examplePackageJsons) {
    const relativePath = packageJsonPath.replace(rootDir + `/`, ``)
    const content = readFileSync(packageJsonPath, `utf-8`)
    const packageJson: PackageJson = JSON.parse(content)

    const depsResult = updateDependencies(packageJson.dependencies, versions)
    const devDepsResult = updateDependencies(
      packageJson.devDependencies,
      versions,
    )
    const peerDepsResult = updateDependencies(
      packageJson.peerDependencies,
      versions,
    )

    if (depsResult.updated || devDepsResult.updated || peerDepsResult.updated) {
      const updatedPackageJson = {
        ...packageJson,
        dependencies: depsResult.deps,
        devDependencies: devDepsResult.deps,
        peerDependencies: peerDepsResult.deps,
      }

      // Preserve original formatting by detecting indent
      const indent = content.match(/^(\s+)"/m)?.[1] || `  `
      writeFileSync(
        packageJsonPath,
        JSON.stringify(updatedPackageJson, null, indent) + `\n`,
      )

      console.log(`✅ Updated: ${relativePath}`)
      totalUpdated++
    }
  }

  if (totalUpdated === 0) {
    console.log(`No example dependencies needed updating.`)
  } else {
    console.log(`\n✅ Updated ${totalUpdated} example package(s).\n`)
  }
}

main()
