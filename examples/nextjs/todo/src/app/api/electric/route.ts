export async function GET(request: Request) {
  const url = new URL(request.url)

  const originUrl = new URL(`http://localhost:3003/v1/shape`)

  url.searchParams.forEach((value, key) => {
    if ([`live`, `table`, `handle`, `offset`, `cursor`].includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  try {
    const response = await fetch(originUrl)

    if (!response.ok) {
      const responseText = await response.text()
      return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    const isLiveRequest = url.searchParams.get(`live`) === `true`

    if (isLiveRequest) {
      const headers = new Headers(response.headers)
      headers.delete(`content-encoding`)
      headers.delete(`content-length`)

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } else {
      const headers = new Headers(response.headers)
      headers.delete(`content-encoding`)
      headers.delete(`content-length`)

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
  } catch (error) {
    return new Response(`Internal Server Error`, { status: 500 })
  }
}
