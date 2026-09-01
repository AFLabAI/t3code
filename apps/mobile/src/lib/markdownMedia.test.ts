import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveMarkdownMediaPreview } from "./markdownMedia";

const input = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  workspaceRoot: "/repo",
};

describe("resolveMarkdownMediaPreview", () => {
  it.each([
    ["/tmp/frame.png", "/tmp/frame.png"],
    ["file:///tmp/frame%20one.png", "/tmp/frame one.png"],
    ["./images/frame.png", "/repo/./images/frame.png"],
    ["/tmp/frame.png:12", "/tmp/frame.png"],
    ["/tmp/frame%23one.png:12", "/tmp/frame#one.png"],
    ["/tmp/frame%3Fone.png:12:3", "/tmp/frame?one.png"],
    ["/tmp/frame%2523one.png:12", "/tmp/frame%23one.png"],
    ["file:///tmp/frame%23one.png:12", "/tmp/frame#one.png"],
  ])("opens %s through the environment media asset service", (href, path) => {
    expect(resolveMarkdownMediaPreview(href, input)).toMatchObject({
      kind: "image",
      source: {
        kind: "image",
        environmentId: input.environmentId,
        resource: { _tag: "media-file", threadId: input.threadId, path },
      },
    });
  });

  it("opens an outside-workspace video as a streamable media resource, not an attachment", () => {
    expect(resolveMarkdownMediaPreview("/tmp/recording.mp4", input)).toEqual({
      kind: "video",
      source: {
        type: "media",
        name: "recording.mp4",
        mimeType: "video/mp4",
        environmentId: input.environmentId,
        resource: { _tag: "media-file", threadId: input.threadId, path: "/tmp/recording.mp4" },
      },
    });
  });

  it("preserves signed external video URLs without routing them through the environment", () => {
    const uri = "https://cdn.example.com/clip.MP4?signature=abc#t=2";
    expect(resolveMarkdownMediaPreview(uri, input)).toEqual({
      kind: "video",
      source: { type: "media", name: "clip.MP4", mimeType: "video/mp4", uri },
    });
  });

  it("preserves an SVG fragment separately from the filesystem asset path", () => {
    expect(resolveMarkdownMediaPreview("/tmp/icons.svg#logo", input)).toMatchObject({
      kind: "image",
      source: { srcFragment: "#logo", resource: { path: "/tmp/icons.svg" } },
    });
  });

  it("retains a local video fragment without adding it to the filesystem path", () => {
    expect(resolveMarkdownMediaPreview("/tmp/clip%23one.mp4#t=2", input)).toMatchObject({
      kind: "video",
      source: {
        srcFragment: "#t=2",
        resource: { _tag: "media-file", path: "/tmp/clip#one.mp4" },
      },
    });
  });

  it.each(["/tmp/log.txt", "https://example.com/docs", "javascript:frame.png", "~/frame.png"])(
    "leaves non-media or unsupported link %s to ordinary navigation",
    (href) => expect(resolveMarkdownMediaPreview(href, input)).toBeNull(),
  );
});
