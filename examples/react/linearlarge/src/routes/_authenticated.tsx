import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(`/_authenticated`)({
  beforeLoad: async () => {
    // Note: In a real app, we'd check session here
    // For now, we'll just render the layout
    // TODO: Add proper auth check when auth routes are implemented
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Outlet />
    </div>
  )
}
