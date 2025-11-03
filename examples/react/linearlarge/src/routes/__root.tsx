import * as React from 'react'
import {
  createRootRoute,
  Outlet,
  Scripts,
  HeadContent,
} from '@tanstack/react-router'
import { ModeProvider } from '@/lib/mode-context'
import { UserProvider } from '@/lib/user-context'
import { WelcomeModal } from '@/components/WelcomeModal'
import '@/styles/globals.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'LinearLarge - TanStack Start + TanStack DB',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: () => (
    <UserProvider>
      <ModeProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Outlet />
          <WelcomeModal />
        </div>
      </ModeProvider>
    </UserProvider>
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
