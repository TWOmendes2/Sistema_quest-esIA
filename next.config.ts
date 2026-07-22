import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactStrictMode: true,
  experimental: {
    cpus: 2
  }
};

export default nextConfig;
