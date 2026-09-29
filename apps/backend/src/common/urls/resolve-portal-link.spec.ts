import { resolvePortalLink } from "./resolve-portal-link";

describe("resolvePortalLink", () => {
  const original = process.env.FOUNDER_PORTAL_URL;
  afterEach(() => {
    process.env.FOUNDER_PORTAL_URL = original;
  });

  test("returns undefined for an undefined path, rather than a bare base URL", () => {
    expect(resolvePortalLink(undefined)).toBeUndefined();
  });

  test("prepends FOUNDER_PORTAL_URL to a relative in-app path", () => {
    process.env.FOUNDER_PORTAL_URL = "https://birr-web.onrender.com";
    expect(resolvePortalLink("/portfolio/abc")).toBe("https://birr-web.onrender.com/portfolio/abc");
  });

  test("falls back to localhost:3000 when FOUNDER_PORTAL_URL isn't set", () => {
    delete process.env.FOUNDER_PORTAL_URL;
    expect(resolvePortalLink("/ops/governed-actions")).toBe("http://localhost:3000/ops/governed-actions");
  });
});
