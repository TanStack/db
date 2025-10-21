import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { Theme } from "@radix-ui/themes"

import Header from "../components/Header"

import appCss from "../styles.css?url"
import "@radix-ui/themes/styles.css"
import "@fontsource/space-grotesk"
import "../../public/capsize.css"

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
        title: `TanStack Start Starter`,
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
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Theme>
          <Header />
          {children}
          <TanStackDevtools
            config={{
              position: `bottom-right`,
            }}
            plugins={[
              {
                name: `Tanstack Router`,
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        </Theme>
        <Scripts />
      </body>
    </html>
  )
}
