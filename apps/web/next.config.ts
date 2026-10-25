import type { NextConfig } from 'next';

const apiInternal = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: [],
  // Browser talks to the API same-origin; Next proxies to the API server.
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiInternal}/api/:path*` }]),
};

export default config;
