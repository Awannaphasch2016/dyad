import path from "node:path";
import type { NextConfig } from "next";

// @clerk/nextjs reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY at startup.
// Doppler and Vercel set CLERK_PUBLISHABLE_KEY.
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  eslint: { ignoreDuringBuilds: true },
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
  },
};

export default nextConfig;
