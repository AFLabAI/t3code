import { describe, expect, it } from "vite-plus/test";

import {
  isWorkspaceBrowserPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspacePreviewEntryPath,
  isWorkspaceVideoPreviewPath,
  mediaKindFromPath,
  mediaMimeType,
  mediaMimeTypeFromExtension,
} from "./filePreview.ts";

describe("workspace file previews", () => {
  it.each(["report.html", "report.HTM", "document.pdf?download=1"])(
    "recognizes browser preview path %s",
    (path) => {
      expect(isWorkspaceBrowserPreviewPath(path)).toBe(true);
      expect(isWorkspacePreviewEntryPath(path)).toBe(true);
    },
  );

  it.each([
    "icon.png",
    "photo.JPEG",
    "animation.gif",
    "vector.svg#mark",
    "texture.webp",
    "image.avif",
  ])("recognizes image preview path %s", (path) => {
    expect(isWorkspaceImagePreviewPath(path)).toBe(true);
    expect(isWorkspacePreviewEntryPath(path)).toBe(true);
  });

  it.each(["README.md", "src/index.ts", "image.png.ts", "png", "recording.mp4"])(
    "rejects non-preview path %s",
    (path) => {
      expect(isWorkspacePreviewEntryPath(path)).toBe(false);
    },
  );

  it.each([
    "recording.mp4",
    "media/Recording.MOV",
    "C:\\Users\\demo\\Downloads\\clip.webm",
    "media/review#take2.mp4",
    "media/review?take2.m4v",
    "media/100%.mp4",
  ])("recognizes literal video file path %s", (path) => {
    expect(isWorkspaceVideoPreviewPath(path)).toBe(true);
  });

  it.each([
    "recording.mp4.txt",
    "recording.mp4/README",
    "recording.mp4#notes",
    "recording.mp4?download=1",
    "recording%2Emp4",
    "preview.png",
  ])("does not interpret URL syntax in video file path %s", (path) => {
    expect(isWorkspaceVideoPreviewPath(path)).toBe(false);
  });
});

describe("media paths", () => {
  it.each([
    ["/tmp/screenshot.png", "image/png", "image"],
    ["../evidence/Recording.MP4", "video/mp4", "video"],
    ["C:\\Users\\demo\\Downloads\\clip.mov", "video/quicktime", "video"],
    ["\\\\host\\share\\clip.webm", "video/webm", "video"],
    ["https://example.com/clip.webm?download=1#t=2", "video/webm", "video"],
    ["file:///tmp/My%20recording.mp4", "video/mp4", "video"],
    ["<images/logo.svg#mark>", "image/svg+xml", "image"],
    ["//cdn.example.com/clip.m4v", "video/mp4", "video"],
    ["images%2Fresult%2Epng", "image/png", "image"],
    ["images/result%23v2.png", "image/png", "image"],
    ["/tmp/100%.png", "image/png", "image"],
    ["data:video/mp4;base64,AAAA", "video/mp4", "video"],
    ["data:image/svg+xml,%3Csvg%20/%3E", "image/svg+xml", "image"],
  ])("classifies %s", (source, mimeType, kind) => {
    expect(mediaMimeType(source)).toBe(mimeType);
    expect(mediaKindFromPath(source)).toBe(kind);
  });

  it.each([
    "",
    "README.md",
    "preview.html",
    "document.pdf",
    "image.png.txt",
    "/tmp/clip.mp4/",
    "https://example.png",
    "https://example.com/download?name=recording.mp4",
    "images/result.png%23secret.txt",
    "images/result.png%3Fsecret.txt",
  ])("does not treat %s as image or video media", (source) => {
    expect(mediaKindFromPath(source)).toBeNull();
  });

  it("validates literal filesystem extensions without interpreting URL syntax", () => {
    expect(mediaMimeTypeFromExtension(".PNG")).toBe("image/png");
    expect(mediaMimeTypeFromExtension(".webm")).toBe("video/webm");
    expect(mediaMimeTypeFromExtension(".png#secret")).toBeNull();
    expect(mediaMimeTypeFromExtension(".png?secret")).toBeNull();
    expect(mediaMimeTypeFromExtension(".%70ng")).toBeNull();
    expect(mediaMimeTypeFromExtension(".png.txt")).toBeNull();
  });
});
