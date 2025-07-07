import { describe, expect, it } from "vitest"
import {
  createRefProxy,
  isRefProxy,
  toExpression,
  val,
} from "../../../src/query/builder/ref-proxy.js"
import { PropRef, Value } from "../../../src/query/ir.js"

describe(`ref-proxy`, () => {
  describe(`createRefProxy`, () => {
    it(`creates a proxy with correct basic properties`, () => {
      const proxy = createRefProxy<{ users: { id: number; name: string } }>([
        `users`,
      ])

      expect((proxy as any).__refProxy).toBe(true)
      expect((proxy as any).__path).toEqual([])
      expect((proxy as any).__type).toBeUndefined()
    })

    it(`handles property access with single level`, () => {
      const proxy = createRefProxy<{ users: { id: number; name: string } }>([
        `users`,
      ])

      const userProxy = proxy.users
      expect((userProxy as any).__refProxy).toBe(true)
      expect((userProxy as any).__path).toEqual([`users`])
    })

    it(`handles deep property access`, () => {
      const proxy = createRefProxy<{ users: { profile: { bio: string } } }>([
        `users`,
      ])

      const bioProxy = proxy.users.profile.bio
      expect((bioProxy as any).__refProxy).toBe(true)
      expect((bioProxy as any).__path).toEqual([`users`, `profile`, `bio`])
    })

    it(`caches proxy objects correctly`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])

      const userProxy1 = proxy.users
      const userProxy2 = proxy.users
      expect(userProxy1).toBe(userProxy2) // Should be the same cached object
    })

    it(`handles symbol properties`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])
      const sym = Symbol(`test`)

      // Should not throw and should return undefined for symbols
      expect((proxy as any)[sym]).toBeUndefined()
    })

    it(`handles has trap correctly`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])

      expect(`__refProxy` in proxy).toBe(true)
      expect(`__path` in proxy).toBe(true)
      expect(`__type` in proxy).toBe(true)
      expect(`__spreadSentinels` in proxy).toBe(true)
      expect(`users` in proxy).toBe(true)
      expect(`nonexistent` in proxy).toBe(false)
    })

    it(`handles ownKeys correctly`, () => {
      const proxy = createRefProxy<{
        users: { id: number }
        posts: { title: string }
      }>([`users`, `posts`])

      const keys = Object.getOwnPropertyNames(proxy)
      expect(keys).toContain(`users`)
      expect(keys).toContain(`posts`)
      expect(keys).toContain(`__refProxy`)
      expect(keys).toContain(`__path`)
      expect(keys).toContain(`__type`)
      expect(keys).toContain(`__spreadSentinels`)
    })

    it(`handles getOwnPropertyDescriptor correctly`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])

      const refProxyDesc = Object.getOwnPropertyDescriptor(proxy, `__refProxy`)
      expect(refProxyDesc).toEqual({
        enumerable: false,
        configurable: true,
        value: undefined,
        writable: false,
      })

      const usersDesc = Object.getOwnPropertyDescriptor(proxy, `users`)
      expect(usersDesc).toEqual({
        enumerable: true,
        configurable: true,
        value: undefined,
        writable: false,
      })

      const nonexistentDesc = Object.getOwnPropertyDescriptor(
        proxy,
        `nonexistent`
      )
      expect(nonexistentDesc).toBeUndefined()
    })

    it(`tracks spread sentinels when accessing ownKeys on table-level proxy`, () => {
      const proxy = createRefProxy<{ users: { id: number; name: string } }>([
        `users`,
      ])

      // Access ownKeys on table-level proxy (should mark as spread)
      Object.getOwnPropertyNames(proxy.users)

      const spreadSentinels = (proxy as any).__spreadSentinels
      expect(spreadSentinels.has(`users`)).toBe(true)
    })

    it(`handles accessing undefined alias`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])

      expect((proxy as any).nonexistent).toBeUndefined()
    })

    it(`handles nested property access with getOwnPropertyDescriptor`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])

      const userProxy = proxy.users
      const desc = Object.getOwnPropertyDescriptor(userProxy, `__refProxy`)
      expect(desc).toEqual({
        enumerable: false,
        configurable: true,
        value: undefined,
        writable: false,
      })
    })

    it(`handles symbols on nested proxies`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])
      const sym = Symbol(`test`)

      const userProxy = proxy.users
      expect((userProxy as any)[sym]).toBeUndefined()
    })
  })

  describe(`isRefProxy`, () => {
    it(`returns true for RefProxy objects`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])
      expect(isRefProxy(proxy)).toBe(true)
      expect(isRefProxy(proxy.users)).toBe(true)
    })

    it(`returns false for non-RefProxy objects`, () => {
      expect(isRefProxy({})).toBe(false)
      expect(isRefProxy(null)).toBe(null) // null && ... returns null in JS
      expect(isRefProxy(undefined)).toBe(undefined) // undefined && ... returns undefined in JS
      expect(isRefProxy(42)).toBe(false) // 42 && (typeof 42 === object) => 42 && false => false
      expect(isRefProxy(`string`)).toBe(false) // string && (typeof string === object) => string && false => false
      expect(isRefProxy({ __refProxy: false })).toBe(false)
    })
  })

  describe(`toExpression`, () => {
    it(`converts RefProxy to Ref expression`, () => {
      const proxy = createRefProxy<{ users: { id: number } }>([`users`])
      const userIdProxy = proxy.users.id

      const expr = toExpression(userIdProxy)
      expect(expr).toBeInstanceOf(PropRef)
      expect(expr.type).toBe(`ref`)
      expect((expr as PropRef).path).toEqual([`users`, `id`])
    })

    it(`converts literal values to Value expression`, () => {
      const expr = toExpression(42)
      expect(expr).toBeInstanceOf(Value)
      expect(expr.type).toBe(`val`)
      expect((expr as Value).value).toBe(42)
    })

    it(`returns existing expressions unchanged`, () => {
      const refExpr = new PropRef([`users`, `id`])
      const valExpr = new Value(42)

      expect(toExpression(refExpr)).toBe(refExpr)
      expect(toExpression(valExpr)).toBe(valExpr)
    })

    it(`handles expressions with different types`, () => {
      const funcExpr = { type: `func` as const, name: `upper`, args: [] }
      const aggExpr = { type: `agg` as const, name: `count`, args: [] }

      expect(toExpression(funcExpr)).toBe(funcExpr)
      expect(toExpression(aggExpr)).toBe(aggExpr)
    })
  })

  describe(`val`, () => {
    it(`creates Value expression from literal`, () => {
      const expr = val(42)
      expect(expr).toBeInstanceOf(Value)
      expect(expr.type).toBe(`val`)
      expect((expr as Value).value).toBe(42)
    })

    it(`handles different value types`, () => {
      expect((val(`string`) as Value).value).toBe(`string`)
      expect((val(true) as Value).value).toBe(true)
      expect((val(null) as Value).value).toBe(null)
      expect((val([1, 2, 3]) as Value).value).toEqual([1, 2, 3])
      expect((val({ a: 1 }) as Value).value).toEqual({ a: 1 })
    })
  })
})
