import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// Public-facing product documentation site — the third-party-readable
// counterpart to docs/core-service.md at the repo root. Content here is
// a Docusaurus-split version of that same source: core-service.md stays
// the canonical, GitHub-viewable version (its own Mermaid diagrams
// render natively there); this site exists for a reader who wants
// browsable pages and navigation instead of one long file. Keep both in
// sync by hand when either changes, same "kept in sync with what's
// actually built" convention every other doc in this repo already
// follows — no automated sync exists.
const config: Config = {
  title: "Birr",
  tagline: "A digital trustee for Islamic waqf",
  favicon: "img/favicon.svg",

  // 2026-09-13: deployed via Render — see render.yaml's own comment on
  // the birr-docs service (a static site, same Blueprint/region the
  // rest of this project already deploys through; GitHub Pages was
  // ruled out since this repo is private). Render's default subdomain
  // is deterministic from that service's own `name`, same as
  // birr-backend/birr-web's own URLs elsewhere in that file — only
  // affects canonical links/sitemap generation, not local development.
  url: "https://birr-docs.onrender.com",
  baseUrl: "/",

  organizationName: "hahu07",
  projectName: "birr",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // Off by default in Docusaurus — needed since these pages carry the
  // same Mermaid diagrams docs/core-service.md renders natively on
  // GitHub (the two-product overview, the Waqf Fund lifecycle, the
  // Vault giving flow, the maker-checker sequence).
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
        // The whole site IS the docs — no separate blog, no generic
        // Docusaurus tutorial homepage. routeBasePath: "/" serves the
        // docs directly at the site root instead of under "/docs/".
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/hahu07/birr/tree/main/apps/docs/",
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
      title: "Birr",
      logo: {
        alt: "Birr logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Documentation",
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
          title: "Documentation",
          items: [
            { label: "What Birr Is", to: "/" },
            { label: "Waqf Funds", to: "/waqf-funds" },
            { label: "Vaults", to: "/vaults" },
            { label: "Governance", to: "/governance" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Birr.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
