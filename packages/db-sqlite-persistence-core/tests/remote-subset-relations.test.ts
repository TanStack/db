import { describe, expect, it } from 'vitest'
import {
  toTransportedLoadSubsetOptions,
  validateRemoteSubsetOptions,
} from '../src/remote-subset-wire'
import type { LoadSubsetOptions } from '@tanstack/db'

describe(`remote subset relation hints`, () => {
  const options = {
    limit: 2,
    relations: [
      {
        quantifier: `some`,
        collectionId: `owners`,
        on: { parent: [`ownerId`], child: [`id`] },
      },
    ],
  } as LoadSubsetOptions

  it(`admits a load with a hint, because an adapter may ignore it`, () => {
    expect(() => validateRemoteSubsetOptions(options)).not.toThrow()
  })

  it(`leaves the optional hint out of the transported request`, () => {
    expect(toTransportedLoadSubsetOptions(options)).toEqual({ limit: 2 })
  })
})
