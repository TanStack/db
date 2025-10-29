#!/usr/bin/env node
import { build } from 'esbuild'
import { gzipSync } from 'zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

mkdirSync('test-bundle-output', { recursive: true })

async function testBundle(name, code) {
  // Write test file
  const inputFile = `test-bundle-output/${name}-input.js`
  const outputFile = `test-bundle-output/${name}-output.js`

  writeFileSync(inputFile, code)

  try {
    await build({
      entryPoints: [inputFile],
      bundle: true,
      minify: false,
      treeShaking: true,
      format: 'esm',
      outfile: outputFile,
      platform: 'neutral',
      external: ['@tanstack/db-ivm'], // External workspace dependency
    })

    const bundled = readFileSync(outputFile, 'utf-8')
    const size = bundled.length
    const gzipped = gzipSync(bundled).length

    console.log(`\n${name}:`)
    console.log(`  Raw size: ${(size / 1024).toFixed(2)} KB`)
    console.log(`  Gzipped:  ${(gzipped / 1024).toFixed(2)} KB`)

    // Check what got included
    const hasQuery = bundled.includes('BaseQueryBuilder') || bundled.includes('query/builder')
    const hasLocalStorage = bundled.includes('localStorageCollectionOptions') || bundled.includes('localStorage')
    const hasProxies = bundled.includes('createChangeProxy')
    const errorCount = (bundled.match(/Error extends/g) || []).length

    console.log(`  Includes Query: ${hasQuery}`)
    console.log(`  Includes LocalStorage: ${hasLocalStorage}`)
    console.log(`  Includes Proxies: ${hasProxies}`)
    console.log(`  Error classes: ~${errorCount}`)

  } catch (error) {
    console.error(`Failed to bundle ${name}:`, error.message)
  }
}

// Test 1: Just createCollection
await testBundle('minimal', `
import { createCollection } from './packages/db/dist/esm/index.js'
console.log(createCollection)
`)

// Test 2: Collection + LocalStorage
await testBundle('with-storage', `
import { createCollection, localStorageCollectionOptions } from './packages/db/dist/esm/index.js'
console.log(createCollection, localStorageCollectionOptions)
`)

// Test 3: Full featured
await testBundle('full', `
import {
  createCollection,
  Query,
  localStorageCollectionOptions,
  createTransaction
} from './packages/db/dist/esm/index.js'
console.log(createCollection, Query, localStorageCollectionOptions, createTransaction)
`)

console.log('\n---')
console.log('If tree-shaking works properly, minimal should be MUCH smaller than full.')
console.log('If they are similar size, tree-shaking is not effective.')
