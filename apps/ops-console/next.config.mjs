/** @type {import('next').NextConfig} */
const nextConfig = {
  // High-privilege internal app — Birr staff only. Never merge this
  // deployment with apps/founder-portal; that's the point of the split.
  transpilePackages: ["@birr/ui"],
  // Bundles only the node_modules subset this app actually needs into
  // .next/standalone — see Dockerfile, which copies just that output
  // rather than the full monorepo node_modules into the runtime image.
  output: "standalone",
};
export default nextConfig;
