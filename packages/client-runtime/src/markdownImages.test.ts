import { describe, expect, it } from "vite-plus/test";

import { classifyMarkdownImageSource, markdownImageSourceFragment } from "./markdownImages.js";

describe("classifyMarkdownImageSource", () => {
  it.each([
    "https://example.com/image.png",
    "https://example.com/recording.mp4#t=2",
    "HTTP://example.com/image.png",
    "data:image/png;base64,AAAA",
    "blob:https://app.t3.codes/image-id",
    "//cdn.example.com/image.png",
  ])("keeps %s directly loadable", (uri) => {
    expect(classifyMarkdownImageSource(uri, "/workspace/project")).toEqual({
      _tag: "Direct",
      uri,
    });
  });

  it.each([
    ["images/result.png", "/workspace/project", "/workspace/project/images/result.png"],
    ["./images/result.png", "/workspace/project", "/workspace/project/./images/result.png"],
    [
      "images/result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    [
      "images\\result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    ["/workspace/project/image.png", null, "/workspace/project/image.png"],
    ["/tmp/image.png", "/workspace/project", "/tmp/image.png"],
    ["/tmp/recording.mp4#t=2", "/workspace/project", "/tmp/recording.mp4"],
    ["../recording.webm", "/workspace/project", "/workspace/project/../recording.webm"],
    ["file:///Users/demo/Downloads/clip%20one.mp4", null, "/Users/demo/Downloads/clip one.mp4"],
    ["/tmp/image%23v2.png", null, "/tmp/image#v2.png"],
    ["/C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["\\\\server\\share\\image.png", null, "\\\\server\\share\\image.png"],
    ["file:///workspace/project/image%20one.png", null, "/workspace/project/image one.png"],
    ["file:///C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["file://localhost/C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["file://server/share/image.png", null, "\\\\server\\share\\image.png"],
  ])("maps %s to an environment file", (source, workspaceRoot, path) => {
    expect(classifyMarkdownImageSource(source, workspaceRoot)).toEqual({
      _tag: "WorkspaceFile",
      path,
    });
  });

  it.each([
    null,
    "",
    "#image",
    "?image=1",
    "image.png",
    "~/image.png",
    "javascript:alert(1)",
    "ftp://example.com/image.png",
    "content://media/image/1",
    "custom:image.png",
    "file://%",
  ])("blocks unsupported or unresolved source %s", (source) => {
    expect(classifyMarkdownImageSource(source)).toEqual({ _tag: "Blocked" });
  });
});

describe("markdownImageSourceFragment", () => {
  it.each([
    ["<icons.svg?version=2#logo>", "#logo"],
    ["icons.svg?version=2", ""],
    ["recording.mp4?version=2#t=3", "#t=3"],
    ["image%23v2.png", ""],
  ])("extracts %s as %s", (source, fragment) => {
    expect(markdownImageSourceFragment(source)).toBe(fragment);
  });
});
