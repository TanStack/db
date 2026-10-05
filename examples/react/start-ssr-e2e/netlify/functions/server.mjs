import server from '../../dist/server/server.js'

export const config = {
  path: '/*',
  preferStatic: true,
}

export default function handler(request) {
  return server.fetch(request)
}
