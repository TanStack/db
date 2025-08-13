import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"
import { TanstackDevtools } from "@tanstack/react-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackReactDbDevtoolsPanel } from "@tanstack/react-db-devtools"
// import { TanStackReactDbDevtools } from "@tanstack/react-db-devtools"

import appCss from "../styles.css?url"

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
        title: `TanStack React DB Example`,
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
      <TanstackDevtools
        plugins={[
          {
            name: "Tanstack Router",
            render: <TanStackRouterDevtoolsPanel />,
          },
          {
            name: "Tanstack DB",
            render: <TanStackReactDbDevtoolsPanel />,
          },
        ]}
      />
      {/* Alternative standalone component */}
      {/* <TanStackReactDbDevtools position="bottom-right" /> */}
    </RootDocument>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
