import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/solid-router"

import appCss from "../styles.css?url"
import { ParentProps } from "solid-js"

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
        title: `TanStack DB Example`,
      },
    ],
    links: [
      {
        rel: `stylesheet`,
        href: appCss,
      },
    ],
  }),

  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
})

function RootDocument(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  )
}
