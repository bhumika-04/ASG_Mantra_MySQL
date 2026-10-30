import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  // React Compiler adds per-file analysis overhead in dev; only enable in production builds.
  reactCompiler: isProd,
};

export default nextConfig;
