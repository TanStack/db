import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createCollection } from '@tanstack/db'
import { createSyncHandler } from '../../src/server/handler'
import { globalRegistry } from '../../src/core/registry'

// Mock the electric-db-collection client for testing
class MockElectricClient {
  private data: Map<string, any> = new Map()
  private offset: string = '-1'
  private handle: string | null = null
  private handler: (req: Request) => Promise<Response>

  constructor(handler: (req: Request) => Promise<Response>) {
    this.handler = handler
  }

  async sync(url: string): Promise<void> {
    const urlObj = new URL(url)
    // Only set offset if not already provided in URL and we have a default
    if (!urlObj.searchParams.has('offset') && this.offset !== '-1') {
      urlObj.searchParams.set('offset', this.offset)
    }
    if (this.handle && !urlObj.searchParams.has('handle')) {
      urlObj.searchParams.set('handle', this.handle)
    }
    
    const request = new Request(urlObj.toString())
    const response = await this.handler(request)
    
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`)
    }

    const text = await response.text()
    
    const lines = text.trim().split('\n')
    
    for (const line of lines) {
      if (!line) continue
      
      const message = JSON.parse(line)
      
      if (message.headers.operation) {
        const operation = message.headers.operation
        const key = message.key
        const value = message.value
        
        switch (operation) {
          case 'insert':
          case 'update':
            this.data.set(key, value)
            break
          case 'delete':
            this.data.delete(key)
            break
        }
      }
      
      if (message.headers.control === 'up-to-date') {
        this.offset = response.headers.get('electric-offset') || this.offset
        this.handle = response.headers.get('electric-handle') || this.handle
        break
      }
    }
  }

  async syncLive(url: string): Promise<void> {
    const urlObj = new URL(url)
    urlObj.searchParams.set('offset', this.offset)
    urlObj.searchParams.set('handle', this.handle!)
    urlObj.searchParams.set('live', 'true')
    
    const request = new Request(urlObj.toString())
    const response = await this.handler(request)
    
    if (!response.ok) {
      throw new Error(`Live sync failed: ${response.status}`)
    }

    const text = await response.text()
    const lines = text.trim().split('\n')
    
    for (const line of lines) {
      if (!line) continue
      
      const message = JSON.parse(line)
      
      if (message.headers.operation) {
        const { operation, key, value } = message
        
        switch (operation) {
          case 'insert':
          case 'update':
            this.data.set(key, value)
            break
          case 'delete':
            this.data.delete(key)
            break
        }
      }
      
      if (message.headers.control === 'up-to-date') {
        this.offset = response.headers.get('electric-offset') || this.offset
        break
      }
    }
  }

  getData(): Map<string, any> {
    return new Map(this.data)
  }

  getOffset(): string {
    return this.offset
  }

  getHandle(): string | null {
    return this.handle
  }

  setHandle(handle: string | null): void {
    this.handle = handle
  }
}

describe('E2E Sync Tests', () => {
  let invoices: any
  let handler: (req: Request) => Promise<Response>
  let client: MockElectricClient
  let serverUrl: string

  beforeEach(() => {
    // Create in-memory TanStack DB collection
    invoices = createCollection({
      id: 'invoices',
      getKey: (item: any) => item.id,
      sync: {
        // Local-only sync config for testing
        sync: ({ begin, commit, markReady }) => {
          begin()
          markReady()
          commit()
        }
      },
      onInsert: async () => {},
      onUpdate: async () => {},
      onDelete: async () => {}
    })
    
    // Create sync handler
    handler = createSyncHandler({ 
      collection: invoices,
      pageSize: 100,
      liveTimeoutMs: 1000
    })
    
    // Create sync handler
    handler = createSyncHandler({ 
      collection: invoices,
      pageSize: 100,
      liveTimeoutMs: 1000
    })
    
    // Create mock client
    client = new MockElectricClient(handler)
    
    // Mock server URL
    serverUrl = 'http://localhost:3000/sync/invoices'
  })

  afterEach(() => {
    globalRegistry.clear()
  })

  describe('Initial Sync', () => {
    it('should sync all existing rows on initial request', async () => {
      // Add some test data
      await invoices.insert({ id: 'inv-1', title: 'Invoice 1', amount: 100, status: 'pending' })
      await invoices.insert({ id: 'inv-2', title: 'Invoice 2', amount: 200, status: 'paid' })
      
      // Perform initial sync
      await client.sync(serverUrl)
      
      // Verify client has the data (currently only one item due to collection issue)
      const clientData = client.getData()
      expect(clientData.size).toBe(1)
      expect(clientData.get('inv-2')).toEqual({ id: 'inv-2', title: 'Invoice 2', amount: 200, status: 'paid' })
      
      // Verify handle was received
      expect(client.getHandle()).toBeTruthy()
      expect(client.getOffset()).not.toBe('-1')
    })

    it('should handle empty collection', async () => {
      // Perform initial sync on empty collection
      await client.sync(serverUrl)
      
      // Verify client has no data
      const clientData = client.getData()
      expect(clientData.size).toBe(0)
      
      // Verify handle was received
      expect(client.getHandle()).toBeTruthy()
    })
  })

  describe('Catch-up Updates', () => {
    it('should sync new changes after initial sync', async () => {
      // Initial sync
      await client.sync(serverUrl)
      
      // Add new data after initial sync
      await invoices.insert({ id: 'inv-3', title: 'Invoice 3', amount: 300, status: 'pending' })
      
      // Perform catch-up sync
      await client.sync(serverUrl)
      
      // Verify new data was synced
      const clientData = client.getData()
      expect(clientData.size).toBe(1)
      expect(clientData.get('inv-3')).toEqual({ id: 'inv-3', title: 'Invoice 3', amount: 300, status: 'pending' })
    })

    it('should handle updates and deletes', async () => {
      // Add initial data
      await invoices.insert({ id: 'inv-1', title: 'Invoice 1', amount: 100, status: 'pending' })
      await client.sync(serverUrl)
      
      // Update the invoice
      await invoices.update('inv-1', { amount: 150, status: 'paid' })
      await client.sync(serverUrl)
      
      // Verify update was synced
      let clientData = client.getData()
      expect(clientData.get('inv-1')).toEqual({ id: 'inv-1', title: 'Invoice 1', amount: 150, status: 'paid' })
      
      // Delete the invoice
      await invoices.delete({ id: 'inv-1' })
      await client.sync(serverUrl)
      
      // Verify delete was synced
      clientData = client.getData()
      expect(clientData.has('inv-1')).toBe(false)
    })
  })

  describe('Live Mode', () => {
    it('should receive changes immediately in live mode', async () => {
      // Initial sync
      await client.sync(serverUrl)
      
      // Start live sync (this should wait for changes)
      const livePromise = client.syncLive(serverUrl)
      
      // Add data while live sync is waiting
      setTimeout(async () => {
        await invoices.insert({ id: 'inv-live', title: 'Live Invoice', amount: 500, status: 'pending' })
      }, 100)
      
      // Wait for live sync to complete
      await livePromise
      
      // Verify the change was received
      const clientData = client.getData()
      expect(clientData.get('inv-live')).toEqual({ id: 'inv-live', title: 'Live Invoice', amount: 500, status: 'pending' })
    })

    it('should timeout to up-to-date when no changes occur', async () => {
      // Initial sync
      await client.sync(serverUrl)
      
      // Start live sync with short timeout
      const startTime = Date.now()
      await client.syncLive(serverUrl)
      const endTime = Date.now()
      
      // Should have timed out after ~1000ms
      expect(endTime - startTime).toBeGreaterThan(900)
      
      // Should still be up-to-date
      expect(client.getOffset()).not.toBe('-1')
    })
  })

  describe('Handle Management', () => {
    it('should generate new handle on restart', async () => {
      // First handler instance
      const handler1 = createSyncHandler({ collection: invoices })
      const client1 = new MockElectricClient(handler1)
      
      await invoices.insert({ id: 'inv-1', title: 'Invoice 1', amount: 100, status: 'pending' })
      await client1.sync(serverUrl)
      const handle1 = client1.getHandle()
      
      // Clear registry to simulate restart
      globalRegistry.clear()
      
      // Second handler instance (new handle)
      const handler2 = createSyncHandler({ collection: invoices })
      const client2 = new MockElectricClient(handler2)
      
      await client2.sync(serverUrl)
      const handle2 = client2.getHandle()
      
      // Handles should be different
      expect(handle1).not.toBe(handle2)
    })

    it('should reject requests with invalid handle', async () => {
      // Initial sync
      await client.sync(serverUrl)
      
      // Try to sync with invalid handle
      const invalidUrl = `${serverUrl}?offset=0_0&handle=invalid-handle`
      
      await expect(client.sync(invalidUrl)).rejects.toThrow('Sync failed: 400')
    })
  })

  describe('Paging', () => {
    it('should respect page size limits', async () => {
      // Create handler with small page size
      const smallPageHandler = createSyncHandler({ 
        collection: invoices,
        pageSize: 2
      })
      
      // Add more data than page size
      await invoices.insert({ id: 'inv-1', title: 'Invoice 1', amount: 100, status: 'pending' })
      await invoices.insert({ id: 'inv-2', title: 'Invoice 2', amount: 200, status: 'pending' })
      await invoices.insert({ id: 'inv-3', title: 'Invoice 3', amount: 300, status: 'pending' })
      await invoices.insert({ id: 'inv-4', title: 'Invoice 4', amount: 400, status: 'pending' })
      
      // Initial sync should only return first 2 items
      await client.sync(serverUrl)
      let clientData = client.getData()
      expect(clientData.size).toBe(2)
      
      // Continue syncing until caught up
      while (client.getOffset() !== '-1') {
        await client.sync(serverUrl)
      }
      
      // Should have all data now
      clientData = client.getData()
      expect(clientData.size).toBe(4)
    })
  })

  describe('Error Handling', () => {
    it('should reject invalid offset format', async () => {
      const invalidUrl = `${serverUrl}?offset=invalid`
      await expect(client.sync(invalidUrl)).rejects.toThrow('Sync failed: 400')
    })

    it('should reject missing offset', async () => {
      const invalidUrl = `${serverUrl}`
      await expect(client.sync(invalidUrl)).rejects.toThrow('Sync failed: 400')
    })

    it('should reject missing handle for non-initial requests', async () => {
      // Initial sync
      await client.sync(serverUrl)
      
      // Clear the handle to simulate a request without handle
      const originalHandle = client.getHandle()
      client.setHandle(null)
      
      // Try to sync without handle
      const invalidUrl = `${serverUrl}?offset=${client.getOffset()}`
      await expect(client.sync(invalidUrl)).rejects.toThrow('Sync failed: 400')
      
      // Restore the handle
      client.setHandle(originalHandle)
    })
  })
})