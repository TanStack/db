import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ModeProvider } from '@/lib/mode-context'
import '@/styles/globals.css'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <ModeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Outlet />
      </div>
    </ModeProvider>
  )
}
