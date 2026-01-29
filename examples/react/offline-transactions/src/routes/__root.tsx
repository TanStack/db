/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import appCss from '~/styles/app.css?url'
import { seo } from '~/utils/seo'
import { queryClient } from '~/utils/queryClient'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: `utf-8`,
      },
      {
        name: `viewport`,
        content: `width=device-width, initial-scale=1`,
      },
      ...seo({
        title: `TanStack Start | Type-Safe, Client-First, Full-Stack React Framework`,
        description: `TanStack Start is a type-safe, client-first, full-stack React framework. `,
      }),
    ],
    links: [
      { rel: `stylesheet`, href: appCss },
      {
        rel: `apple-touch-icon`,
        sizes: `180x180`,
        href: `/apple-touch-icon.png`,
      },
      {
        rel: `icon`,
        type: `image/png`,
        sizes: `32x32`,
        href: `/favicon-32x32.png`,
      },
      {
        rel: `icon`,
        type: `image/png`,
        sizes: `16x16`,
        href: `/favicon-16x16.png`,
      },
      { rel: `manifest`, href: `/site.webmanifest`, color: `#fffff` },
      { rel: `icon`, href: `/favicon.ico` },
    ],
    scripts: [
      {
        src: `/customScript.js`,
        type: `text/javascript`,
      },
    ],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <div className="bg-white shadow-sm border-b">
            <div className="max-w-4xl mx-auto px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">⚡</span>
                  <span className="text-xl font-bold text-gray-900">
                    TanStack Offline Transactions
                  </span>
                </div>
                <div className="flex gap-6 text-sm">
                  <Link
                    to="/"
                    activeProps={{
                      className: `font-bold text-blue-600`,
                    }}
                    activeOptions={{ exact: true }}
                    className="text-gray-600 hover:text-gray-900"
                  >
                    Home
                  </Link>
                  <Link
                    to="/indexeddb"
                    activeProps={{
                      className: `font-bold text-blue-600`,
                    }}
                    className="text-gray-600 hover:text-gray-900"
                  >
                    🗄️ IndexedDB
                  </Link>
                  <Link
                    to="/localstorage"
                    activeProps={{
                      className: `font-bold text-blue-600`,
                    }}
                    className="text-gray-600 hover:text-gray-900"
                  >
                    💾 localStorage
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <hr />
          {children}
          <TanStackRouterDevtools position="bottom-right" />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
