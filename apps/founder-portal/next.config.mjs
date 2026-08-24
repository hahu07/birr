/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deliberately separate deployment from apps/ops-console — see
  // CLAUDE.md's Tech Stack section for why. Do not add cross-imports
  // between the two apps beyond a shared component/types package.
  transpilePackages: ["@birr/ui"],
  // Bundles only the node_modules subset this app actually needs into
  // .next/standalone — see Dockerfile, which copies just that output
  // rather than the full monorepo node_modules into the runtime image.
  output: "standalone",
};
export default nextConfig;
