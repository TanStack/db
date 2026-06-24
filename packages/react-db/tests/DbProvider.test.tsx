import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { DbClient } from '@tanstack/db'
import { DbProvider, useDbClient } from '../src/DbProvider'
import type { ReactNode } from 'react'

describe(`DbProvider`, () => {
  it(`provides a DbClient to hooks`, () => {
    const client = new DbClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbProvider client={client}>{children}</DbProvider>
    )

    const { result } = renderHook(() => useDbClient(), { wrapper })

    expect(result.current).toBe(client)
  })

  it(`throws without a provider`, () => {
    expect(() => renderHook(() => useDbClient())).toThrow(
      /useDbClient must be used within a DbProvider/,
    )
  })
})
