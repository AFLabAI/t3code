import { describe, expect, it } from "@effect/vitest";

import { extractToolActivityPresentation } from "./toolPresentation.ts";

describe("extractToolActivityPresentation", () => {
  it("preserves explicit source metadata and theme-specific logos", () => {
    expect(
      extractToolActivityPresentation({
        toolSurface: "browser",
        toolSource: {
          key: "integration:example",
          name: "Example",
          kind: "integration",
          icon: {
            _tag: "themed-logo",
            logoUrl: "https://example.com/logo-light.png",
            logoUrlDark: "https://example.com/logo-dark.png",
          },
        },
      }),
    ).toEqual({
      toolSurface: "browser",
      toolSource: {
        key: "integration:example",
        name: "Example",
        kind: "integration",
        icon: {
          _tag: "themed-logo",
          logoUrl: "https://example.com/logo-light.png",
          logoUrlDark: "https://example.com/logo-dark.png",
        },
      },
    });
  });

  it("recovers the page and theme-specific favicons from older raw Codex events", () => {
    expect(
      extractToolActivityPresentation({
        data: {
          item: {
            result: {
              _meta: {
                "codex/toolSurface": {
                  kind: "browserUse",
                  screenshot: {
                    pageUrl: "https://example.com/docs",
                    favIconUrl: "https://example.com/icon.png",
                    favIconUrlDark: "https://example.com/icon-dark.png",
                  },
                },
              },
            },
          },
        },
      }),
    ).toEqual({
      toolSurface: "browser",
      toolIcon: {
        _tag: "website",
        pageUrl: "https://example.com/docs",
        faviconUrl: "https://example.com/icon.png",
        faviconUrlDark: "https://example.com/icon-dark.png",
      },
      toolSource: { key: "browser-use:browser", name: "Browser", kind: "browser" },
    });
  });
});
