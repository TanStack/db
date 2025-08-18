import type { Collection } from '@tanstack/db'
import type { SyncEndpoint, ElectricHeaders } from '../types'
import { VersionIndex } from '../core/versionIndex'
import { EventBus } from '../core/eventBus'
import { ElectricStreamEncoder } from '../core/stream'
import { globalRegistry } from '../core/registry'
import { parseOffset, isValidOffset, formatOffset } from '../core/offsets'

/**
 * Create a sync handler for a TanStack DB collection
 * @param endpoint The sync endpoint configuration
 * @returns A function that handles HTTP requests
 */
export function createSyncHandler(endpoint: SyncEndpoint): (req: Request) => Promise<Response> {
  const { collection, pageSize = 5000, liveTimeoutMs = 30000 } = endpoint
  
  // Create version index and event bus
  const versionIndex = new VersionIndex()
  const eventBus = new EventBus()
  const encoder = new ElectricStreamEncoder()
  
  // Generate shape handle for this handler instance
  const shapeHandle = globalRegistry.generateHandle()
  
  // Subscribe to collection changes
  const unsubscribe = collection.subscribeChanges((change) => {
    const pk = change.pk as string
    let op: 'insert' | 'update' | 'delete'
    
    switch (change.type) {
      case 'insert':
        op = 'insert'
        break
      case 'update':
        op = 'update'
        break
      case 'delete':
        op = 'delete'
        break
      default:
        return // Ignore unknown change types
    }
    
    // Record the change in version index
    versionIndex.recordChange(pk, op)
    
    // Emit to event bus for live requests
    eventBus.emit({
      v: versionIndex.version,
      pk,
      op
    })
  })
  
  // Backfill PK metadata for existing rows
  for (const [pk, row] of versionIndex.scanSnapshot(collection)) {
    // Metadata is already set in scanSnapshot
  }
  
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url)
      const offset = url.searchParams.get('offset')
      const live = url.searchParams.get('live')
      const handle = url.searchParams.get('handle')
      
      // Validate required parameters
      if (!offset) {
        return new Response('Missing required parameter: offset', { status: 400 })
      }
      
      if (!isValidOffset(offset)) {
        return new Response('Invalid offset format', { status: 400 })
      }
      
      // For non-initial requests, validate handle
      if (offset !== '-1') {
        if (!handle) {
          return new Response('Missing required parameter: handle', { status: 400 })
        }
        
        if (!globalRegistry.hasHandle(handle)) {
          return new Response('Invalid shape handle', { status: 400 })
        }
      }
      
      const isLive = live === 'true' || live === '1'
      const isInitial = offset === '-1'
      
      // Prepare response headers
      const headers: ElectricHeaders = {
        'electric-offset': offset,
        'electric-handle': shapeHandle.id
      }
      
      // Handle initial sync
      if (isInitial) {
        return handleInitialSync(collection, versionIndex, encoder, headers)
      }
      
      // Handle catch-up or live mode
      return handleCatchUpOrLive(
        collection, 
        versionIndex, 
        eventBus, 
        encoder, 
        headers, 
        offset, 
        isLive, 
        pageSize, 
        liveTimeoutMs
      )
      
    } catch (error) {
      console.error('Error in sync handler:', error)
      return new Response('Internal server error', { status: 500 })
    }
  }
}

/**
 * Handle initial sync (offset = -1)
 */
function handleInitialSync(
  collection: Collection<any, any>,
  versionIndex: VersionIndex,
  encoder: ElectricStreamEncoder,
  headers: ElectricHeaders
): Response {
  const stream = new ReadableStream({
    start(controller) {
      let count = 0
      
      // Stream all current rows as insert operations
      for (const [pk, row] of versionIndex.scanSnapshot(collection)) {
        const message = encoder.encodeInsert(pk.toString(), row)
        controller.enqueue(encoder.toUint8Array(message))
        count++
      }
      
      // Add up-to-date control message
      const upToDateMessage = encoder.encodeUpToDate()
      controller.enqueue(encoder.toUint8Array(upToDateMessage))
      
      controller.close()
    }
  })
  
  // Set final headers
  headers['electric-offset'] = versionIndex.head
  headers['electric-up-to-date'] = 'true'
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers
    }
  })
}

/**
 * Handle catch-up or live mode
 */
function handleCatchUpOrLive(
  collection: Collection<any, any>,
  versionIndex: VersionIndex,
  eventBus: EventBus,
  encoder: ElectricStreamEncoder,
  headers: ElectricHeaders,
  offset: string,
  isLive: boolean,
  pageSize: number,
  liveTimeoutMs: number
): Response {
  // Check if there are changes immediately
  if (versionIndex.hasChangesAfter(offset)) {
    return streamChanges(collection, versionIndex, encoder, headers, offset, pageSize)
  }
  
  // If not live mode, return up-to-date immediately
  if (!isLive) {
    return streamUpToDate(encoder, headers, versionIndex.head)
  }
  
  // Live mode: wait for changes
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          // Wait for next change with timeout
          const change = await eventBus.waitForChange(liveTimeoutMs)
          
          // Stream the change
          const row = collection.get(change.pk)
          let message: string
          
          switch (change.op) {
            case 'insert':
              message = encoder.encodeInsert(change.pk.toString(), row)
              break
            case 'update':
              message = encoder.encodeUpdate(change.pk.toString(), row)
              break
            case 'delete':
              message = encoder.encodeDelete(change.pk.toString())
              break
          }
          
          controller.enqueue(encoder.toUint8Array(message))
          controller.close()
          
        } catch (error) {
          // Timeout or error - return up-to-date
          const upToDateMessage = encoder.encodeUpToDate()
          controller.enqueue(encoder.toUint8Array(upToDateMessage))
          controller.close()
        }
      }
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...headers
      }
    }
  )
}

/**
 * Stream changes after a specific offset
 */
function streamChanges(
  collection: Collection<any, any>,
  versionIndex: VersionIndex,
  encoder: ElectricStreamEncoder,
  headers: ElectricHeaders,
  offset: string,
  pageSize: number
): Response {
  const stream = new ReadableStream({
    start(controller) {
      let count = 0
      let lastOffset = offset
      
      // Stream changes up to page size
      for (const change of versionIndex.changesAfter(offset)) {
        if (count >= pageSize) break
        
        const row = collection.get(change.pk)
        let message: string
        
        switch (change.op) {
          case 'insert':
            message = encoder.encodeInsert(change.pk.toString(), row)
            break
          case 'update':
            message = encoder.encodeUpdate(change.pk.toString(), row)
            break
          case 'delete':
            message = encoder.encodeDelete(change.pk.toString())
            break
        }
        
        controller.enqueue(encoder.toUint8Array(message))
        lastOffset = formatOffset(change.v)
        count++
      }
      
      // Check if we're caught up
      if (!versionIndex.hasChangesAfter(lastOffset)) {
        const upToDateMessage = encoder.encodeUpToDate()
        controller.enqueue(encoder.toUint8Array(upToDateMessage))
        headers['electric-up-to-date'] = 'true'
      }
      
      headers['electric-offset'] = lastOffset
      controller.close()
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers
    }
  })
}

/**
 * Stream up-to-date control message
 */
function streamUpToDate(
  encoder: ElectricStreamEncoder,
  headers: ElectricHeaders,
  currentOffset: string
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const upToDateMessage = encoder.encodeUpToDate()
      controller.enqueue(encoder.toUint8Array(upToDateMessage))
      controller.close()
    }
  })
  
  headers['electric-offset'] = currentOffset
  headers['electric-up-to-date'] = 'true'
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers
    }
  })
}