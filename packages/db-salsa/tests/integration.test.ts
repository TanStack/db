import { beforeEach, describe, expect, it } from 'vitest'
import {
  Database,
  createCollectionAdapter,
  createMetricsTracker,
  createSalsaQuery,
} from '../src/index.js'

describe('TanStack DB Integration', () => {
  let db: Database

  beforeEach(() => {
    db = new Database()
  })

  describe('Collection Adapter', () => {
    it('should create an adapter for collection data', () => {
      const users = new Map([
        [1, { id: 1, name: 'John', active: true }],
        [2, { id: 2, name: 'Jane', active: false }],
      ])

      const usersAdapter = createCollectionAdapter(db, 'users', users)

      // Reading should work
      expect(usersAdapter.getData().size).toBe(2)
    })

    it('should track collection changes via revision', () => {
      interface User {
        id: number
        name: string
        active: boolean
      }

      const users = new Map<number, User>([
        [1, { id: 1, name: 'John', active: true }],
      ])

      const usersAdapter = createCollectionAdapter(db, 'users', users)
      let computeCount = 0

      const activeCount = db.query('activeCount', () => {
        computeCount++
        const data = usersAdapter.getData()
        return [...data.values()].filter((u) => u.active).length
      })

      expect(activeCount.read()).toBe(1)
      expect(computeCount).toBe(1)

      // Simulate collection change
      users.set(2, { id: 2, name: 'Jane', active: true })
      usersAdapter.notifyChange()

      expect(activeCount.read()).toBe(2)
      expect(computeCount).toBe(2)
    })
  })

  describe('Salsa Live Query', () => {
    it('should create a Salsa-aware query', () => {
      const count = db.input('count', 10)

      const doubled = createSalsaQuery(db, 'doubled', () => count.get() * 2)

      expect(doubled.read()).toBe(20)
      expect(doubled.isStale()).toBe(false)

      count.set(20)
      expect(doubled.isStale()).toBe(true)

      expect(doubled.read()).toBe(40)
      expect(doubled.isStale()).toBe(false)
    })

    it('should support subscriptions', () => {
      const count = db.input('count', 10)
      const doubled = createSalsaQuery(db, 'doubled', () => count.get() * 2)

      const values: Array<number> = []
      doubled.subscribe((v) => values.push(v))

      doubled.read()
      count.set(20)
      doubled.read()

      expect(values).toEqual([20, 40])
    })
  })

  describe('Metrics Tracker', () => {
    it('should track query metrics', () => {
      const count = db.input('count', 10)
      const doubled = db.query('doubled', () => count.get() * 2)
      const tracker = createMetricsTracker(db)

      // First read
      doubled.read()

      let metrics = tracker.getMetrics(doubled.id)
      expect(metrics?.executionCount).toBe(1)
      expect(metrics?.cacheHitCount).toBe(0)

      // Cache hit
      doubled.read()
      doubled.read()

      // Change and recompute
      count.set(20)
      doubled.read()

      metrics = tracker.getMetrics(doubled.id)
      expect(metrics?.executionCount).toBe(2)
    })

    it('should provide all metrics', () => {
      const a = db.input('a', 1)
      const b = db.input('b', 2)

      const sum = db.query('sum', () => a.get() + b.get())
      const doubled = db.query('doubled', () => sum.read() * 2)

      const tracker = createMetricsTracker(db)

      doubled.read()
      a.set(10)
      doubled.read()

      const allMetrics = tracker.getAllMetrics()
      expect(allMetrics.length).toBe(2) // sum and doubled
    })
  })

  describe('Real-world patterns', () => {
    it('should handle filtered + sorted query pattern', () => {
      interface Item {
        id: number
        name: string
        priority: number
        active: boolean
      }

      const items = new Map<number, Item>([
        [1, { id: 1, name: 'Task A', priority: 2, active: true }],
        [2, { id: 2, name: 'Task B', priority: 1, active: false }],
        [3, { id: 3, name: 'Task C', priority: 3, active: true }],
      ])

      const itemsAdapter = createCollectionAdapter(db, 'items', items)
      const filterActive = db.input('filterActive', true)

      // Filtered query
      const filteredItems = createSalsaQuery(db, 'filteredItems', () => {
        const data = itemsAdapter.getData()
        const active = filterActive.get()
        return [...data.values()].filter((item) => !active || item.active)
      })

      // Sorted query (depends on filtered)
      const sortedItems = createSalsaQuery(db, 'sortedItems', () => {
        return [...filteredItems.read()].sort((a, b) => a.priority - b.priority)
      })

      // Initial read
      let sorted = sortedItems.read()
      expect(sorted.map((i) => i.name)).toEqual(['Task A', 'Task C'])

      // Disable filter
      filterActive.set(false)
      sorted = sortedItems.read()
      expect(sorted.map((i) => i.name)).toEqual(['Task B', 'Task A', 'Task C'])

      // Add new item
      items.set(4, { id: 4, name: 'Task D', priority: 0, active: true })
      itemsAdapter.notifyChange()
      sorted = sortedItems.read()
      expect(sorted.map((i) => i.name)).toEqual([
        'Task D',
        'Task B',
        'Task A',
        'Task C',
      ])
    })

    it('should handle aggregation query pattern', () => {
      interface Sale {
        id: number
        product: string
        amount: number
        region: string
      }

      const sales = new Map<number, Sale>([
        [1, { id: 1, product: 'Widget', amount: 100, region: 'North' }],
        [2, { id: 2, product: 'Gadget', amount: 200, region: 'South' }],
        [3, { id: 3, product: 'Widget', amount: 150, region: 'North' }],
      ])

      const salesAdapter = createCollectionAdapter(db, 'sales', sales)

      // Total by product
      const totalByProduct = createSalsaQuery(db, 'totalByProduct', () => {
        const data = salesAdapter.getData()
        const totals = new Map<string, number>()
        for (const sale of data.values()) {
          totals.set(sale.product, (totals.get(sale.product) || 0) + sale.amount)
        }
        return totals
      })

      // Total by region
      const totalByRegion = createSalsaQuery(db, 'totalByRegion', () => {
        const data = salesAdapter.getData()
        const totals = new Map<string, number>()
        for (const sale of data.values()) {
          totals.set(sale.region, (totals.get(sale.region) || 0) + sale.amount)
        }
        return totals
      })

      // Grand total (depends on both)
      const grandTotal = createSalsaQuery(db, 'grandTotal', () => {
        const byProduct = totalByProduct.read()
        return [...byProduct.values()].reduce((sum, v) => sum + v, 0)
      })

      expect(totalByProduct.read().get('Widget')).toBe(250)
      expect(totalByRegion.read().get('North')).toBe(250)
      expect(grandTotal.read()).toBe(450)

      // Add new sale
      sales.set(4, { id: 4, product: 'Widget', amount: 50, region: 'South' })
      salesAdapter.notifyChange()

      expect(totalByProduct.read().get('Widget')).toBe(300)
      expect(totalByRegion.read().get('South')).toBe(250)
      expect(grandTotal.read()).toBe(500)
    })

    it('should handle join-like query pattern', () => {
      interface User {
        id: number
        name: string
      }

      interface Post {
        id: number
        userId: number
        title: string
      }

      const users = new Map<number, User>([
        [1, { id: 1, name: 'Alice' }],
        [2, { id: 2, name: 'Bob' }],
      ])

      const posts = new Map<number, Post>([
        [1, { id: 1, userId: 1, title: 'First Post' }],
        [2, { id: 2, userId: 1, title: 'Second Post' }],
        [3, { id: 3, userId: 2, title: 'Bob\'s Post' }],
      ])

      const usersAdapter = createCollectionAdapter(db, 'users', users)
      const postsAdapter = createCollectionAdapter(db, 'posts', posts)

      // Joined query: posts with user names
      const postsWithAuthors = createSalsaQuery(db, 'postsWithAuthors', () => {
        const userData = usersAdapter.getData()
        const postData = postsAdapter.getData()

        return [...postData.values()].map((post) => ({
          ...post,
          authorName: userData.get(post.userId)?.name || 'Unknown',
        }))
      })

      let result = postsWithAuthors.read()
      expect(result.find((p) => p.id === 1)?.authorName).toBe('Alice')
      expect(result.find((p) => p.id === 3)?.authorName).toBe('Bob')

      // Update user name
      users.set(1, { id: 1, name: 'Alicia' })
      usersAdapter.notifyChange()

      result = postsWithAuthors.read()
      expect(result.find((p) => p.id === 1)?.authorName).toBe('Alicia')
    })
  })
})
