import { describe, expect, it } from "vite-plus/test";

import {
  resolveMarkdownFileIcon,
  resolveMarkdownInlineCodePresentation,
  resolveMarkdownLinkPresentation,
} from "@t3tools/mobile-markdown-text/links";

describe("resolveMarkdownFileIcon", () => {
  it.each(["avi", "m4v", "mkv", "mov", "mp4", "ogv", "webm"])(
    "uses a video icon for .%s files",
    (extension) => expect(resolveMarkdownFileIcon(`recording.${extension}`)).toBe("video"),
  );

  it.each([
    "C:\\Videos\\Recording.MP4",
    "/tmp/recording.webm:12:4",
    "media/take#1.mp4",
    "media/take?1.mp4",
    "media/take%20.mp4",
  ])("recognizes the literal video path %s", (path) => {
    expect(resolveMarkdownFileIcon(path)).toBe("video");
  });

  it.each([
    ["recording.mp4.txt", "text"],
    ["recording.mp4.ts", "typescript"],
    ["recording%2Emp4", "default"],
    ["recording.mp4#t=1", "default"],
  ])("keeps the literal filename classification for %s", (path, icon) => {
    expect(resolveMarkdownFileIcon(path)).toBe(icon);
  });
});

describe("resolveMarkdownLinkPresentation", () => {
  it("extracts external link hosts", () => {
    expect(resolveMarkdownLinkPresentation("https://example.com/docs?q=1")).toEqual({
      kind: "external",
      href: "https://example.com/docs?q=1",
      host: "example.com",
    });
  });

  it("renders file URLs as basename pills with positions", () => {
    expect(
      resolveMarkdownLinkPresentation("file:///Users/julius/project/src/main.ts#L42C7"),
    ).toEqual({
      kind: "file",
      href: "file:///Users/julius/project/src/main.ts#L42C7",
      icon: "typescript",
      label: "main.ts:42:7",
      path: "/Users/julius/project/src/main.ts",
      line: 42,
      column: 7,
    });
  });

  it("recognizes relative source paths and bare filenames", () => {
    expect(resolveMarkdownLinkPresentation("apps/mobile/src/index.ts:10")).toEqual({
      kind: "file",
      href: "apps/mobile/src/index.ts:10",
      icon: "typescript",
      label: "index.ts:10",
      path: "apps/mobile/src/index.ts",
      line: 10,
    });
    expect(resolveMarkdownLinkPresentation("AGENTS.md")).toEqual({
      kind: "file",
      href: "AGENTS.md",
      icon: "agents",
      label: "AGENTS.md",
      path: "AGENTS.md",
    });
    expect(resolveMarkdownLinkPresentation("package.json")).toEqual({
      kind: "file",
      href: "package.json",
      icon: "package",
      label: "package.json",
      path: "package.json",
    });
  });

  it.each(["md", "html", "xml"])("recognizes a bare spaced .%s filename", (extension) => {
    expect(
      resolveMarkdownLinkPresentation(`Updated%20cutover%20checklist.${extension}`),
    ).toMatchObject({
      kind: "file",
      path: `Updated cutover checklist.${extension}`,
      label: `Updated cutover checklist.${extension}`,
    });
  });

  it("recognizes spaced relative paths", () => {
    expect(resolveMarkdownLinkPresentation("docs/My%20Folder/checklist.xml")).toMatchObject({
      kind: "file",
      path: "docs/My Folder/checklist.xml",
      label: "checklist.xml",
    });
  });

  it("extracts line fragments from relative file links", () => {
    expect(resolveMarkdownLinkPresentation("src/main.ts#L18C2")).toMatchObject({
      kind: "file",
      path: "src/main.ts",
      line: 18,
      column: 2,
      label: "main.ts:18:2",
    });
  });

  it("uses the Pierre complete icon mappings", () => {
    expect(resolveMarkdownLinkPresentation("src/Button.tsx")).toMatchObject({
      kind: "file",
      icon: "react",
    });
    expect(resolveMarkdownLinkPresentation("vite.config.ts")).toMatchObject({
      kind: "file",
      icon: "vite",
    });
    expect(resolveMarkdownLinkPresentation("Dockerfile")).toMatchObject({
      kind: "file",
      icon: "docker",
    });
    expect(resolveMarkdownLinkPresentation("pnpm-lock.yaml")).toMatchObject({
      kind: "file",
      icon: "pnpm",
    });
  });

  it.each([
    "/tmp/recording.mp4",
    "file:///tmp/Recording%20Final.MP4#t=1",
    "media/recording%2Emp4?download=1#t=2",
    "media/recording.webm:12:4",
  ])("uses a video icon for the Markdown destination %s", (href) => {
    expect(resolveMarkdownLinkPresentation(href)).toMatchObject({
      kind: "file",
      icon: "video",
    });
  });

  it("does not style app routes as file links", () => {
    expect(resolveMarkdownLinkPresentation("/chat/settings")).toEqual({
      kind: "link",
      href: null,
    });
  });
});

describe("resolveMarkdownInlineCodePresentation", () => {
  it.each([
    ["/tmp/recording.mp4", "/tmp/recording.mp4", "recording.mp4"],
    ["./images/result.png", "./images/result.png", "result.png"],
    ["src/main.ts:12", "src/main.ts", "main.ts:12"],
    ["file:///tmp/screen.png", "/tmp/screen.png", "screen.png"],
    ["Makefile:12", "Makefile", "Makefile:12"],
    ["Justfile:8:2", "Justfile", "Justfile:8:2"],
  ])("recognizes file reference %s", (content, path, label) => {
    expect(resolveMarkdownInlineCodePresentation(content)).toMatchObject({
      kind: "file",
      path,
      label,
    });
  });

  it.each(["image.png", "npm run dev", "foo.bar", "example.com/image.png", "error:1", "src/*.ts"])(
    "keeps %s as ordinary code",
    (content) => expect(resolveMarkdownInlineCodePresentation(content)).toBeNull(),
  );
});
