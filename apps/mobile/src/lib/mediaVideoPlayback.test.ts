import { describe, expect, it, vi } from "vite-plus/test";

import { loadMediaVideoSource } from "./mediaVideoPlayback";

describe("loadMediaVideoSource", () => {
  it("loads an expanded media URL paused without fetching a local copy", async () => {
    const player = { pause: vi.fn(), play: vi.fn(), replaceAsync: vi.fn(async () => {}) };
    await loadMediaVideoSource(player, {
      uri: "https://environment.example/api/assets/signed-video",
      signal: new AbortController().signal,
      playRequested: false,
      isActive: () => true,
    });
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.replaceAsync).toHaveBeenCalledWith({
      uri: "https://environment.example/api/assets/signed-video",
      contentType: "progressive",
    });
    expect(player.play).not.toHaveBeenCalled();
  });

  it("starts an explicitly requested Play only after source replacement finishes", async () => {
    const ready = Promise.withResolvers<void>();
    const player = { pause: vi.fn(), play: vi.fn(), replaceAsync: vi.fn(() => ready.promise) };
    const loading = loadMediaVideoSource(player, {
      uri: "https://example.com/clip.mp4",
      signal: new AbortController().signal,
      playRequested: true,
      isActive: () => true,
    });
    expect(player.play).not.toHaveBeenCalled();
    ready.resolve();
    await loading;
    expect(player.play).toHaveBeenCalledOnce();
  });

  it.each(["closed", "background"])(
    "does not start a pending video after the viewer is %s",
    async (reason) => {
      const ready = Promise.withResolvers<void>();
      const controller = new AbortController();
      let active = true;
      const player = { pause: vi.fn(), play: vi.fn(), replaceAsync: vi.fn(() => ready.promise) };
      const loading = loadMediaVideoSource(player, {
        uri: "https://example.com/clip.mp4",
        signal: controller.signal,
        playRequested: true,
        isActive: () => active,
      });
      if (reason === "closed") controller.abort();
      else active = false;
      ready.resolve();
      await loading;
      expect(player.play).not.toHaveBeenCalled();
    },
  );
});
