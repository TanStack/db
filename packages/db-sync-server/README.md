# @tanstack/db-sync-server

HTTP server for TanStack DB collections using Electric-compatible streaming API.

## Overview

This package provides a framework-agnostic HTTP server that exposes TanStack DB collections over HTTP using the Electric HTTP Shape API. It supports offset-based streaming and long-polling for real-time synchronization.

## Features

- **Electric-compatible API**: Follows the Electric HTTP Shape API specification
- **Real-time streaming**: Supports live mode with long-polling
- **Offset-based pagination**: Efficient catch-up and paging
- **Framework-agnostic**: Single function that returns Request → Response
- **In-memory version index**: Uses B+Tree from TanStack DB for efficient storage
- **Auto-generated handles**: Unique shape handles per server restart

## Installation

```bash
npm install @tanstack/db-sync-server
```

## Quick Start

```typescript
import { createDB } from '@tanstack/db'
import { createSyncHandler } from '@tanstack/db-sync-server'

// Create your TanStack DB
const db = createDB({
  name: 'my-app',
  schema: {
    invoices: {
      id: { type: 'string' },
      title: { type: 'string' },
      amount: { type: 'number' },
      status: { type: 'string' }
    }
  }
})

const invoices = db.collection('invoices')

// Create the sync handler
const handler = createSyncHandler({ 
  collection: invoices,
  pageSize: 5000,
  liveTimeoutMs: 30000
})

// Mount in your HTTP server
app.get('/sync/invoices', async (req, res) => {
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`)
  const fetchReq = new Request(url.toString(), { 
    method: 'GET', 
    headers: req.headers as any 
  })
  
  const resp = await handler(fetchReq)
  
  // Copy headers
  resp.headers.forEach((v, k) => res.setHeader(k, v))
  
  // Send response
  res.status(resp.status).send(Buffer.from(await resp.arrayBuffer()))
})
```

## API Reference

### `createSyncHandler(endpoint: SyncEndpoint)`

Creates a sync handler function that processes HTTP requests.

#### Parameters

- `endpoint.collection`: The TanStack DB collection to sync
- `endpoint.pageSize` (optional): Maximum records per response (default: 5000)
- `endpoint.liveTimeoutMs` (optional): Live mode timeout in milliseconds (default: 30000)

#### Returns

A function that takes a `Request` and returns a `Promise<Response>`.

## HTTP API

The handler supports the following query parameters:

### Required Parameters

- `offset`: The offset in the shape stream
  - Use `-1` for initial sync
  - Use previous `electric-offset` header value for catch-up

### Optional Parameters

- `live`: Set to `true` or `1` for live mode (long-polling)
- `handle`: Shape handle (required for non-initial requests)

### Response Headers

- `electric-offset`: Latest offset in the response
- `electric-handle`: Shape handle for subsequent requests
- `electric-up-to-date`: Present when caught up

### Response Format

The response is a stream of newline-delimited JSON messages:

```json
{"headers":{"operation":"insert","lsn":"123","op_position":"0"},"key":"inv-1","value":{"id":"inv-1","title":"Invoice 1","amount":100}}
{"headers":{"operation":"update","lsn":"124","op_position":"0"},"key":"inv-1","value":{"amount":150}}
{"headers":{"control":"up-to-date"}}
```

## Usage Examples

### Express.js

```typescript
import express from 'express'
import { createSyncHandler } from '@tanstack/db-sync-server'

const app = express()
const handler = createSyncHandler({ collection: invoices })

app.get('/sync/invoices', async (req, res) => {
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`)
  const fetchReq = new Request(url.toString(), { 
    method: 'GET', 
    headers: req.headers as any 
  })
  
  const resp = await handler(fetchReq)
  
  resp.headers.forEach((v, k) => res.setHeader(k, v))
  res.status(resp.status).send(Buffer.from(await resp.arrayBuffer()))
})
```

### Next.js API Route

```typescript
// pages/api/sync/invoices.ts
import { NextApiRequest, NextApiResponse } from 'next'
import { createSyncHandler } from '@tanstack/db-sync-server'

const handler = createSyncHandler({ collection: invoices })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end()
  }

  const url = new URL(req.url!, `http://${req.headers.host}`)
  const fetchReq = new Request(url.toString(), { 
    method: 'GET', 
    headers: req.headers as any 
  })
  
  const resp = await handler(fetchReq)
  
  resp.headers.forEach((v, k) => res.setHeader(k, v))
  res.status(resp.status).send(Buffer.from(await resp.arrayBuffer()))
}
```

### Fastify

```typescript
import Fastify from 'fastify'
import { createSyncHandler } from '@tanstack/db-sync-server'

const fastify = Fastify()
const handler = createSyncHandler({ collection: invoices })

fastify.get('/sync/invoices', async (request, reply) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const fetchReq = new Request(url.toString(), { 
    method: 'GET', 
    headers: request.headers as any 
  })
  
  const resp = await handler(fetchReq)
  
  resp.headers.forEach((v, k) => reply.header(k, v))
  reply.status(resp.status).send(Buffer.from(await resp.arrayBuffer()))
})
```

## Client Usage

Use the `@tanstack/electric-db-collection` client to consume the sync API:

```typescript
import { createElectricCollection } from '@tanstack/electric-db-collection'

const electricCollection = createElectricCollection({
  url: 'http://localhost:3000/sync/invoices',
  // ... other options
})

// Subscribe to changes
electricCollection.subscribe((changes) => {
  console.log('Received changes:', changes)
})
```

## Architecture

### Version Index

The server maintains an in-memory version index using B+Tree from TanStack DB:

- **PK Index**: Maps primary keys to latest metadata (version, deleted status)
- **Version Log**: Maps version numbers to change events
- **Current Version**: Monotonically increasing version counter

### Event Bus

A simple pub/sub system for waking up live requests when changes occur.

### Shape Handles

Auto-generated UUIDs that identify sync sessions. New handles are generated on each server restart.

## Testing

Run the test suite:

```bash
npm test
```

The package includes comprehensive unit tests and E2E tests that verify Electric API compatibility.

## License

MIT