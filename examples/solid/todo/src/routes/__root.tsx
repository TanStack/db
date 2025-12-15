import { Outlet, createRootRoute } from "@tanstack/solid-router"

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

  component: () => <Outlet />,
})
