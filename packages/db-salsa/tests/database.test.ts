import { beforeEach, describe, expect, it } from 'vitest'
import {
  Database,
  createDebugLogger,
  getPerformanceStats,
  toDot,
} from '../src/index.js'

describe('Database', () => {
  let db: Database

  beforeEach(() => {
    db = new Database({ debug: false })
  })

  describe('inputs', () => {
    it('should create and read inputs', () => {
      const name = db.input('name', 'John')
      expect(name.get()).toBe('John')
    })

    it('should update inputs and increment revision', () => {
      const name = db.input('name', 'John')
      const rev1 = name.revision()

      name.set('Jane')
      const rev2 = name.revision()

      expect(name.get()).toBe('Jane')
      expect(rev2).toBeGreaterThan(rev1)
    })

    it('should not increment revision for same value', () => {
      const name = db.input('name', 'John')
      const rev1 = name.revision()

      name.set('John') // Same value
      const rev2 = name.revision()

      expect(rev1).toBe(rev2)
    })

    it('should throw for duplicate input names', () => {
      db.input('name', 'John')
      expect(() => db.input('name', 'Jane')).toThrow()
    })
  })

  describe('queries', () => {
    it('should compute and memoize query results', () => {
      const name = db.input('name', 'John')
      let computeCount = 0

      const greeting = db.query('greeting', () => {
        computeCount++
        return `Hello, ${name.get()}!`
      })

      expect(greeting.read()).toBe('Hello, John!')
      expect(computeCount).toBe(1)

      // Second read should use cached value
      expect(greeting.read()).toBe('Hello, John!')
      expect(computeCount).toBe(1)
    })

    it('should recompute when input changes', () => {
      const name = db.input('name', 'John')
      let computeCount = 0

      const greeting = db.query('greeting', () => {
        computeCount++
        return `Hello, ${name.get()}!`
      })

      expect(greeting.read()).toBe('Hello, John!')
      expect(computeCount).toBe(1)

      name.set('Jane')

      expect(greeting.read()).toBe('Hello, Jane!')
      expect(computeCount).toBe(2)
    })

    it('should not recompute for unrelated input changes', () => {
      const name = db.input('name', 'John')
      const unrelated = db.input('unrelated', 42)
      let computeCount = 0

      const greeting = db.query('greeting', () => {
        computeCount++
        return `Hello, ${name.get()}!`
      })

      greeting.read()
      expect(computeCount).toBe(1)

      unrelated.set(100) // Change unrelated input

      greeting.read()
      // Should still be 1 if we had proper dependency tracking
      // Currently will be 2 because we don't track what wasn't read
      // This is actually correct - the query didn't read unrelated
      expect(computeCount).toBe(1)
    })

    it('should track nested query dependencies', () => {
      const firstName = db.input('firstName', 'John')
      const lastName = db.input('lastName', 'Doe')

      let fullNameComputes = 0
      let greetingComputes = 0

      const fullName = db.query('fullName', () => {
        fullNameComputes++
        return `${firstName.get()} ${lastName.get()}`
      })

      const greeting = db.query('greeting', () => {
        greetingComputes++
        return `Hello, ${fullName.read()}!`
      })

      expect(greeting.read()).toBe('Hello, John Doe!')
      expect(fullNameComputes).toBe(1)
      expect(greetingComputes).toBe(1)

      // Change first name - both should recompute
      firstName.set('Jane')

      expect(greeting.read()).toBe('Hello, Jane Doe!')
      expect(fullNameComputes).toBe(2)
      expect(greetingComputes).toBe(2)
    })

    it('should detect dependency cycles', () => {
      // Create a query that depends on itself (via another query)
      const queryA = db.query('queryA', () => {
        return queryB.read() + 1
      })

      const queryB = db.query('queryB', () => {
        return queryA.read() + 1
      })

      expect(() => queryA.read()).toThrow(/cycle/i)
    })

    it('should throw for duplicate query names', () => {
      db.query('greeting', () => 'Hello')
      expect(() => db.query('greeting', () => 'World')).toThrow()
    })
  })

  describe('cache status', () => {
    it('should report fresh cache', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      greeting.read()
      expect(greeting.checkStale().type).toBe('fresh')
    })

    it('should report stale cache', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      greeting.read()
      name.set('Jane')

      const status = greeting.checkStale()
      expect(status.type).toBe('stale')
      if (status.type === 'stale') {
        expect(status.reason.changedDep).toContain('name')
      }
    })

    it('should report missing cache', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      expect(greeting.checkStale().type).toBe('missing')
    })
  })

  describe('readIfUpToDate', () => {
    it('should return value if up to date', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      greeting.read()
      const rev = greeting.currentRev()

      expect(greeting.readIfUpToDate(rev)).toBe('Hello, John!')
    })

    it('should return undefined if stale', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      greeting.read()
      const rev = greeting.currentRev()

      name.set('Jane')

      expect(greeting.readIfUpToDate(rev)).toBeUndefined()
    })
  })

  describe('subscriptions', () => {
    it('should notify subscribers on recompute', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      const values: Array<string> = []
      greeting.subscribe((value) => values.push(value))

      greeting.read() // Initial computation
      expect(values).toEqual(['Hello, John!'])

      name.set('Jane')
      greeting.read() // Recomputation

      expect(values).toEqual(['Hello, John!', 'Hello, Jane!'])
    })

    it('should allow unsubscribing', () => {
      const name = db.input('name', 'John')
      const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

      const values: Array<string> = []
      const unsubscribe = greeting.subscribe((value) => values.push(value))

      greeting.read()
      unsubscribe()

      name.set('Jane')
      greeting.read()

      expect(values).toEqual(['Hello, John!'])
    })
  })

  describe('forced recomputation', () => {
    it('should recompute even when fresh', () => {
      const name = db.input('name', 'John')
      let computeCount = 0

      const greeting = db.query('greeting', () => {
        computeCount++
        return `Hello, ${name.get()}!`
      })

      greeting.read()
      expect(computeCount).toBe(1)

      greeting.read({ force: true })
      expect(computeCount).toBe(2)
    })
  })
})

describe('Debug features', () => {
  it('should log recompute events', () => {
    const db = new Database()
    const logger = createDebugLogger(db)

    const name = db.input('name', 'John')
    const greeting = db.query('greeting', () => `Hello, ${name.get()}!`)

    greeting.read()
    expect(logger.events.length).toBe(1)
    expect(logger.events[0].queryId).toContain('greeting')
    expect(logger.events[0].reason).toBe('initial')

    name.set('Jane')
    greeting.read()

    expect(logger.events.length).toBe(2)
    expect(logger.events[1].reason).toBe('stale')

    logger.unsubscribe()
  })

  it('should generate DOT graph', () => {
    const db = new Database()

    const a = db.input('a', 1)
    const b = db.input('b', 2)

    const sum = db.query('sum', () => a.get() + b.get())
    const doubled = db.query('doubled', () => sum.read() * 2)

    doubled.read()

    const dot = toDot(db.getGraphSnapshot())

    expect(dot).toContain('digraph SalsaGraph')
    expect(dot).toContain('input:a')
    expect(dot).toContain('input:b')
    expect(dot).toContain('query:sum')
    expect(dot).toContain('query:doubled')
  })

  it('should calculate performance stats', () => {
    const db = new Database()

    const a = db.input('a', 1)
    const sum = db.query('sum', () => a.get() * 2)

    // Read multiple times to get cache hits
    sum.read()
    sum.read()
    sum.read()

    const stats = getPerformanceStats(db.getGraphSnapshot())

    expect(stats.totalQueries).toBe(1)
    expect(stats.cachedQueries).toBe(1)
    expect(stats.totalCacheHits).toBe(2) // 2 cache hits after initial compute
  })
})

describe('Graph snapshot', () => {
  it('should capture current graph state', () => {
    const db = new Database()

    const firstName = db.input('firstName', 'John')
    const lastName = db.input('lastName', 'Doe')

    const fullName = db.query('fullName', () => {
      return `${firstName.get()} ${lastName.get()}`
    })

    const greeting = db.query('greeting', () => {
      return `Hello, ${fullName.read()}!`
    })

    greeting.read()

    const snapshot = db.getGraphSnapshot()

    expect(snapshot.inputs.length).toBe(2)
    expect(snapshot.queries.length).toBe(2)
    expect(snapshot.edges.length).toBe(3) // greeting->fullName, fullName->firstName, fullName->lastName

    // Verify edges
    const edgeSet = new Set(snapshot.edges.map((e) => `${e.from}->${e.to}`))
    expect(edgeSet.has('query:fullName->input:firstName')).toBe(true)
    expect(edgeSet.has('query:fullName->input:lastName')).toBe(true)
    expect(edgeSet.has('query:greeting->query:fullName')).toBe(true)
  })
})

describe('Complex dependency scenarios', () => {
  it('should handle diamond dependencies', () => {
    const db = new Database()

    //     A
    //    / \
    //   B   C
    //    \ /
    //     D

    const a = db.input('a', 1)
    let bCount = 0,
      cCount = 0,
      dCount = 0

    const b = db.query('b', () => {
      bCount++
      return a.get() * 2
    })

    const c = db.query('c', () => {
      cCount++
      return a.get() * 3
    })

    const d = db.query('d', () => {
      dCount++
      return b.read() + c.read()
    })

    expect(d.read()).toBe(5) // 2 + 3
    expect(bCount).toBe(1)
    expect(cCount).toBe(1)
    expect(dCount).toBe(1)

    // Change A - all should recompute
    a.set(2)
    expect(d.read()).toBe(10) // 4 + 6
    expect(bCount).toBe(2)
    expect(cCount).toBe(2)
    expect(dCount).toBe(2)
  })

  it('should handle conditional dependencies', () => {
    const db = new Database()

    const useA = db.input('useA', true)
    const a = db.input('a', 10)
    const b = db.input('b', 20)

    let computeCount = 0

    const result = db.query('result', () => {
      computeCount++
      if (useA.get()) {
        return a.get()
      } else {
        return b.get()
      }
    })

    expect(result.read()).toBe(10)
    expect(computeCount).toBe(1)

    // Changing b shouldn't affect anything when useA is true
    b.set(30)
    // But since we can't know the conditional, it will still be fresh
    // because b wasn't read in the last execution
    expect(result.read()).toBe(10)
    expect(computeCount).toBe(1) // No recompute!

    // Now switch to use b
    useA.set(false)
    expect(result.read()).toBe(30)
    expect(computeCount).toBe(2)
  })

  it('should handle many levels of nesting', () => {
    const db = new Database()

    const root = db.input('root', 1)
    let totalComputes = 0

    // Create a chain: root -> q1 -> q2 -> q3 -> q4 -> q5
    const q1 = db.query('q1', () => {
      totalComputes++
      return root.get() + 1
    })
    const q2 = db.query('q2', () => {
      totalComputes++
      return q1.read() + 1
    })
    const q3 = db.query('q3', () => {
      totalComputes++
      return q2.read() + 1
    })
    const q4 = db.query('q4', () => {
      totalComputes++
      return q3.read() + 1
    })
    const q5 = db.query('q5', () => {
      totalComputes++
      return q4.read() + 1
    })

    expect(q5.read()).toBe(6) // 1+1+1+1+1+1
    expect(totalComputes).toBe(5)

    // All should be cached now
    expect(q5.read()).toBe(6)
    expect(totalComputes).toBe(5) // No additional computes

    // Change root - all should recompute
    root.set(10)
    expect(q5.read()).toBe(15) // 10+1+1+1+1+1
    expect(totalComputes).toBe(10)
  })
})
