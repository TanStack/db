import Providers from "./providers"
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: `Todo App - TanStack DB Example`,
  description: `A todo application built with Next.js and TanStack DB`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
