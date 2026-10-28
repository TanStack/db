/**
 * Ordinary tests for the metadata world fixture: a scenario is cloned once per
 * world, so aliases stay within a world and the replay input stays untouched.
 * The publication law is owned by
 * collection-metadata-publication-oracle.property.test.ts.
 */
import { expect, it } from 'vitest'
import { metadataWorlds } from './metadata-publication-worlds.js'

it(`keeps metadata aliases within each independent input world`, () => {
  const value = { nested: 1 }
  const input = {
    first: value,
    second: value,
    absentValue: undefined,
    nan: NaN,
  }
  const worlds = metadataWorlds(input)
  for (const world of [worlds.model, worlds.driver]) {
    expect(world.first).toBe(world.second)
    expect(world.first).not.toBe(value)
    expect(world).toEqual(input)
  }
  expect(worlds.model.first).not.toBe(worlds.driver.first)
  worlds.driver.first.nested = 2
  expect(worlds.model.first.nested).toBe(1)
  expect(value.nested).toBe(1)
})
