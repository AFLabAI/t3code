import { describe, expect, it } from "vite-plus/test";

import { inlineCodeFilePathCandidate, isConventionalFilePosition } from "./markdownLinks.js";

describe("inlineCodeFilePathCandidate", () => {
  it.each([
    [" /tmp/image.png ", "/tmp/image.png"],
    ["/Users/demo/Downloads/recording.mp4", "/Users/demo/Downloads/recording.mp4"],
    ["evidence/recording.webm", "evidence/recording.webm"],
    ["src\\main.ts", "src/main.ts"],
    [".\\scripts\\deploy", "./scripts/deploy"],
    ["C:\\Users\\demo\\image.png", "C:\\Users\\demo\\image.png"],
    ["\\\\server\\share\\image.png", "\\\\server\\share\\image.png"],
    ["file:///tmp/image.png", "file:///tmp/image.png"],
    ["~/Downloads/image.png", "~/Downloads/image.png"],
    ["script.ts:10", "script.ts:10"],
    ["src/main.ts:10:3", "src/main.ts:10:3"],
    ["Makefile:12", "Makefile:12"],
    ["conf.d/nginx.conf", "conf.d/nginx.conf"],
    ["script.pl:10", "script.pl:10"],
  ])("keeps path evidence in %s", (source, candidate) => {
    expect(inlineCodeFilePathCandidate(source)).toBe(candidate);
  });

  it.each([
    "",
    "node.meta",
    "image.png",
    "git worktree list --porcelain",
    "Recorded evidence here: /tmp/image.png",
    "`/tmp/image.png`",
    "/tmp/image.png\n/tmp/recording.mp4",
    "origin/main",
    "apps/web",
    "127.0.0.1:3000",
    "localhost/index.html",
    "example.com/index.html",
    "example.uk/index.html",
    "example.com:8080",
  ])("leaves %s as code", (source) => {
    expect(inlineCodeFilePathCandidate(source)).toBeNull();
  });
});

describe("isConventionalFilePosition", () => {
  it("distinguishes extensionless file locations from labels and ports", () => {
    expect(isConventionalFilePosition("Makefile:12")).toBe(true);
    expect(isConventionalFilePosition("Dockerfile:8:2")).toBe(true);
    expect(isConventionalFilePosition("Makefile")).toBe(false);
    expect(isConventionalFilePosition("error:1")).toBe(false);
    expect(isConventionalFilePosition("TODO:12")).toBe(false);
    expect(isConventionalFilePosition("port:3000")).toBe(false);
  });
});
