import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import type { ComposerFileAttachment } from "../../composerDraftStore";
import {
  attachVideoThumbnail,
  buildExpandedImagePreview,
  downloadVideoPreview,
  resolveMarkdownMediaPreview,
} from "./ExpandedImagePreview";

describe("resolveMarkdownMediaPreview", () => {
  const threadRef = {
    environmentId: EnvironmentId.make("media-environment"),
    threadId: ThreadId.make("media-thread"),
  };
  const asset = {
    relativeUrl: "/api/assets/signed/frame.png",
    expiresAt: 123456789,
  };

  it.each([
    ["/tmp/frame.png", "/tmp/frame.png"],
    ["file:///tmp/frame%20one.png", "/tmp/frame one.png"],
    ["images/frame.png", "/repo/images/frame.png"],
    ["/tmp/frame%23one.png", "/tmp/frame#one.png"],
    ["/tmp/frame%2523.png", "/tmp/frame%23.png"],
    ["/tmp/frame%25.png", "/tmp/frame%.png"],
    ["/tmp/frame%3Fone.png", "/tmp/frame?one.png"],
    ["/tmp/frame%23one.png:12:3", "/tmp/frame#one.png"],
    ["file:///tmp/frame%2523.png:12", "/tmp/frame%23.png"],
  ])(
    "resolves %s against its owning environment without copying the file",
    async (source, path) => {
      const createAssetUrl = vi.fn().mockResolvedValue(AsyncResult.success(asset));
      const preview = await resolveMarkdownMediaPreview({
        source,
        cwd: "/repo",
        threadRef,
        httpBaseUrl: "https://environment.test",
        createAssetUrl,
      });

      expect(createAssetUrl).toHaveBeenCalledExactlyOnceWith({
        environmentId: threadRef.environmentId,
        input: { resource: { _tag: "media-file", threadId: threadRef.threadId, path } },
      });
      expect(preview?.images[0]?.src).toBe("https://environment.test/api/assets/signed/frame.png");
      expect(preview?.images[0]).not.toHaveProperty("originalUrl");
    },
  );

  it("keeps an SVG fragment on its signed URL, not the filesystem path", async () => {
    const createAssetUrl = vi.fn().mockResolvedValue(AsyncResult.success(asset));
    const preview = await resolveMarkdownMediaPreview({
      source: "/tmp/icons.svg#logo",
      threadRef,
      httpBaseUrl: "https://environment.test",
      createAssetUrl,
    });

    expect(createAssetUrl.mock.calls[0]?.[0].input.resource.path).toBe("/tmp/icons.svg");
    expect(preview?.images[0]?.src).toBe(
      "https://environment.test/api/assets/signed/frame.png#logo",
    );
  });

  it("keeps a video fragment when removing a file-location suffix", async () => {
    const createAssetUrl = vi.fn().mockResolvedValue(AsyncResult.success(asset));
    const preview = await resolveMarkdownMediaPreview({
      source: "/tmp/clip%23one.mp4:12#t=3",
      threadRef,
      httpBaseUrl: "https://environment.test",
      createAssetUrl,
    });

    expect(createAssetUrl.mock.calls[0]?.[0].input.resource.path).toBe("/tmp/clip#one.mp4");
    expect(preview?.images[0]).toEqual({
      src: "https://environment.test/api/assets/signed/frame.png#t=3",
      name: "clip#one.mp4",
      type: "video",
      autoPlay: false,
    });
  });

  it.each([
    ["~/Downloads/frame.png", "/home/julius/Downloads/frame.png"],
    ["/tmp/frame%2523one.png", "/tmp/frame%23one.png"],
  ])("uses the file-link resolver's literal path for %s", async (source, resolvedFilePath) => {
    const createAssetUrl = vi.fn().mockResolvedValue(AsyncResult.success(asset));
    await resolveMarkdownMediaPreview({
      source,
      resolvedFilePath,
      threadRef,
      httpBaseUrl: "https://environment.test",
      createAssetUrl,
    });
    expect(createAssetUrl.mock.calls[0]?.[0].input.resource.path).toBe(resolvedFilePath);
  });

  it("opens a remote video paused without downloading it or minting an environment URL", async () => {
    const createAssetUrl = vi.fn();
    const fetchMedia = vi.fn();
    vi.stubGlobal("fetch", fetchMedia);
    try {
      const source = "https://cdn.example.com/clip.MP4?signature=abc#t=2";
      expect(await resolveMarkdownMediaPreview({ source, createAssetUrl })).toEqual({
        images: [
          { src: source, originalUrl: source, name: "clip.MP4", type: "video", autoPlay: false },
        ],
        index: 0,
      });
      expect(createAssetUrl).not.toHaveBeenCalled();
      expect(fetchMedia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["png", "mp4"])(
    "retains a %s host-page URL for explicit navigation when embedding fails",
    async (extension) => {
      const source = `https://github.com/owner/repo/blob/main/diagram.${extension}?raw=false#L1`;
      const createAssetUrl = vi.fn();

      const preview = await resolveMarkdownMediaPreview({ source, createAssetUrl });

      expect(preview?.images[0]).toMatchObject({ src: source, originalUrl: source });
      expect(createAssetUrl).not.toHaveBeenCalled();
    },
  );

  it("surfaces missing-file errors from the environment", async () => {
    const createAssetUrl = vi
      .fn()
      .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("File was deleted"))));
    await expect(
      resolveMarkdownMediaPreview({
        source: "/tmp/deleted.mp4",
        threadRef,
        httpBaseUrl: "https://environment.test",
        createAssetUrl,
      }),
    ).rejects.toThrow("File was deleted");
  });

  it("requires a connected environment for host files", async () => {
    const createAssetUrl = vi.fn();
    await expect(
      resolveMarkdownMediaPreview({ source: "/tmp/frame.png", createAssetUrl }),
    ).rejects.toThrow("Reconnect");
    expect(createAssetUrl).not.toHaveBeenCalled();
  });

  it.each([
    "/tmp/log.txt",
    "/tmp/private.png%23secret.txt",
    "https://example.com/docs",
    "https://example.com/frame.png:12",
    "javascript:frame.png",
    "~/frame.png",
  ])("leaves unsupported reference %s alone", async (source) => {
    const createAssetUrl = vi.fn();
    expect(await resolveMarkdownMediaPreview({ source, createAssetUrl })).toBeNull();
    expect(createAssetUrl).not.toHaveBeenCalled();
  });
});

describe("buildExpandedImagePreview", () => {
  it("builds a video preview for a local video attachment", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "demo.mp4", { type: "video/mp4" });
    const attachment: ComposerFileAttachment = {
      type: "file",
      id: "video-1",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      file,
    };

    const preview = buildExpandedImagePreview([attachment], attachment.id);

    expect(preview).toMatchObject({
      images: [{ name: "demo.mp4", type: "video" }],
      index: 0,
    });
    expect(preview?.images[0]?.src).toMatch(/^blob:/);
    URL.revokeObjectURL(preview?.images[0]?.src ?? "");
  });

  it("releases a video thumbnail URL when detached", async () => {
    const video = { src: "" } as HTMLVideoElement;
    const file = new File([new Uint8Array([1, 2, 3])], "demo.mp4", { type: "video/mp4" });

    const detach = attachVideoThumbnail(video, file);
    const url = video.src;

    expect((await fetch(url)).ok).toBe(true);
    detach();
    await expect(fetch(url)).rejects.toThrow();
  });

  it("downloads a video through a local blob URL", async () => {
    vi.useFakeTimers();
    const source = URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3])]));
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    vi.stubGlobal("document", { createElement: () => anchor });

    try {
      await downloadVideoPreview(source, "demo.mp4");

      expect(anchor.download).toBe("demo.mp4");
      expect(anchor.href).toMatch(/^blob:/);
      expect(anchor.href).not.toBe(source);
      expect(click).toHaveBeenCalledOnce();
      expect((await fetch(anchor.href)).ok).toBe(true);

      await vi.runAllTimersAsync();
      await expect(fetch(anchor.href)).rejects.toThrow();
    } finally {
      URL.revokeObjectURL(source);
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
