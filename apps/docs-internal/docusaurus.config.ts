import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// Internal-only documentation site — Birr's own staff processes (the
// Ops Console, and whatever else joins it later), as opposed to
// apps/docs, which is public, third-party-readable product
// documentation. This split exists because the two audiences are
// genuinely different: apps/docs is safe for anyone (a prospective
// Founder, a partner institution, an auditor) to read; this site
// describes how Birr's own staff actually operate the platform —
// role permissions, the approval queue, internal admin settings — and
// was never meant to be public. See docs/ops-console.md (repo root,
// the file this site's own docs/ops-console.md started from) for the
// fuller context on why this got its own deployment.
//
// Meant to sit behind Cloudflare Access once deployed (see render.yaml's
// own comment on the birr-docs-internal service) — noIndex below is a
// second, independent layer (keeps search engines from indexing it even
// if Access is ever misconfigured), not a substitute for the actual
// access gate.
const config: Config = {
  title: "Birr — Internal",
  tagline: "Internal staff documentation — not for public distribution",
  favicon: "img/favicon.svg",
  noIndex: true,

  // Placeholder — Render assigns the real hostname when this service is
  // first created, and it is NOT guaranteed to be exactly
  // `birr-docs-internal.onrender.com` (see render.yaml's own BACKEND_URL
  // comment: birr-backend hit a naming collision and got a suffixed
  // hostname instead of its plain service name — confirm the actual
  // assigned hostname in Render's dashboard before trusting this, same
  // lesson that comment already recorded once). Also update this once a
  // real custom domain is set up behind Cloudflare Access, since that
  // (not the Render subdomain) will be the real address people use.
  url: "https://birr-docs-internal.onrender.com",
  baseUrl: "/",

  organizationName: "hahu07",
  projectName: "birr",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  themes: ["@docusaurus/theme-mermaid"],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/hahu07/birr/tree/main/apps/docs-internal/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "Birr — Internal",
      logo: {
        alt: "Birr logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Staff Documentation",
        },
        {
          href: "https://github.com/hahu07/birr",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Staff Documentation",
          items: [
            { label: "Start here", to: "/" },
            { label: "The Ops Console", to: "/ops-console" },
          ],
        },
        {
          title: "Elsewhere",
          items: [{ label: "Public docs (apps/docs)", href: "https://birr-docs.onrender.com" }],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Birr. Internal use only.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
