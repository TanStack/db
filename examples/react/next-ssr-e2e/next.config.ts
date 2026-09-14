import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [`@tanstack/db`, `@tanstack/react-db`],
}

export default nextConfig
