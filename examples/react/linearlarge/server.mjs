import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const clientDir = resolve(__dirname, 'dist/client')

// Import the server bundle
const { default: server } = await import('./dist/server/server.js')

// MIME types for static files
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
}

function serveStatic(url) {
  const filePath = join(clientDir, url === '/' ? 'index.html' : url)

  if (!existsSync(filePath) || !filePath.startsWith(clientDir)) {
    return null
  }

  const stat = statSync(filePath)
  if (stat.isDirectory()) {
    return null
  }

  const ext = extname(filePath)
  const contentType = mimeTypes[ext] || 'application/octet-stream'

  return { filePath, contentType }
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // Try to serve static files first (except for API routes and server functions)
  if (!url.pathname.startsWith('/_serverFn') && !url.pathname.startsWith('/api')) {
    const staticFile = serveStatic(url.pathname)
    if (staticFile) {
      res.writeHead(200, { 'Content-Type': staticFile.contentType })
      createReadStream(staticFile.filePath).pipe(res)
      return
    }
  }

  // If not a static file or is an API route, use the TanStack Start server
  try {
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    })

    const response = await server.fetch(request)

    res.writeHead(response.status, Object.fromEntries(response.headers))

    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }

    res.end()
  } catch (error) {
    console.error('Server error:', error)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')
  }
})

const port = process.env.PORT || 4173
httpServer.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
