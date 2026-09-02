import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Founder-facing and Ops Console surfaces are merged into this one
  // deployment (see the founder-portal/ops-console merge plan) but stay
  // logically separate inside it: app/(founder) and app/ops are distinct
  // route groups, each with its own session provider and layout — see
  // those layouts' own comments for why.
  transpilePackages: ["@birr/ui"],
  // Bundles only the node_modules subset this app actually needs into
  // .next/standalone — see Dockerfile, which copies just that output
  // rather than the full monorepo node_modules into the runtime image.
  output: "standalone",
  // Without this, Turbopack infers the workspace root by walking up for
  // the nearest lockfile and can land on an unrelated one outside this
  // repo, which crashes the dev server. fileURLToPath (not URL.pathname
  // — that leaves a malformed leading slash before the drive letter on
  // Windows, e.g. "/C:/Users/...", which itself crashed Turbopack with
  // "Invalid distDirRoot: '.next' ... should not navigate out of the
  // projectPath") is the cross-platform-correct way to turn a file: URL
  // back into a real OS path.
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};
export default nextConfig;
