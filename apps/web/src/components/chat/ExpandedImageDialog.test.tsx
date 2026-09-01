// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ExpandedImageDialog } from "./ExpandedImageDialog";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

describe("ExpandedImageDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens outside a clipping parent and removes the portal when Escape closes it", async () => {
    const preview: ExpandedImagePreview = {
      images: [{ src: "https://environment.test/demo.mp4", name: "demo.mp4", type: "video" }],
      index: 0,
    };
    function PreviewHost() {
      const [open, setOpen] = useState(true);
      return (
        <div style={{ overflow: "hidden", contentVisibility: "auto" }}>
          {open ? <ExpandedImageDialog preview={preview} onClose={() => setOpen(false)} /> : null}
        </div>
      );
    }

    await act(() => root.render(<PreviewHost />));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
    expect(dialog?.querySelector("video")).not.toBeNull();

    await act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([
    ["https://cdn.example.com/clip.mp4", "video"],
    ["//cdn.example.com/clip.mp4", "video"],
    ["https://cdn.example.com/frame.png", "image"],
    ["//cdn.example.com/frame.png", "image"],
  ] as const)("retains a way to open %s after decoding fails", async (src, kind) => {
    const preview: ExpandedImagePreview = {
      images: [
        { src, originalUrl: src, name: "preview", ...(kind === "video" ? { type: kind } : {}) },
      ],
      index: 0,
    };
    await act(() => root.render(<ExpandedImageDialog preview={preview} onClose={() => {}} />));
    const media = document.querySelector(kind === "video" ? "video" : "img");
    expect(media).not.toBeNull();

    await act(() => media!.dispatchEvent(new Event("error")));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    const originalLink = document.querySelector<HTMLAnchorElement>('[role="dialog"] a');
    expect(originalLink?.textContent).toBe("Open original");
    expect(originalLink?.getAttribute("href")).toBe(src);
    expect(originalLink?.target).toBe("_blank");
    expect(originalLink?.rel).toBe("noopener noreferrer");
  });

  it("does not offer original-page navigation for signed host-file capabilities", async () => {
    const preview: ExpandedImagePreview = {
      images: [{ src: "https://environment.test/api/assets/signed/frame.png", name: "frame.png" }],
      index: 0,
    };
    await act(() => root.render(<ExpandedImageDialog preview={preview} onClose={() => {}} />));

    await act(() => document.querySelector("img")!.dispatchEvent(new Event("error")));

    expect(document.body.textContent).toContain("Image unavailable");
    expect(document.querySelector('[role="dialog"] a')).toBeNull();
  });
});
