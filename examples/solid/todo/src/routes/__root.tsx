import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/solid-router'
import { HydrationScript } from 'solid-js/web'
import appCss from '../styles.css?url'
import type { ParentProps } from 'solid-js'

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
      {
        title: `TanStack Solid DB Example`,
      },
    ],
    links: [
      {
        rel: `stylesheet`,
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
})

function RootDocument(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <HydrationScript />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  )
}
