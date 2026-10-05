import path from "node:path";
import type { NextConfig } from "next";
import { assertPreviewGasCityUrl } from "./lib/gas_city_url";

assertPreviewGasCityUrl();

// @clerk/nextjs reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY at startup.
// Doppler and Vercel set CLERK_PUBLISHABLE_KEY.
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  eslint: { ignoreDuringBuilds: true },
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? "",
  },
};

export default nextConfig;
