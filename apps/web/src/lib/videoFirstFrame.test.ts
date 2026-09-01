import { describe, expect, it, vi } from "vite-plus/test";

import { prepareVideoFirstFrame } from "./videoFirstFrame";

type PreviewVideo = Parameters<typeof prepareVideoFirstFrame>[0];

function previewVideo(overrides: Partial<PreviewVideo> = {}): PreviewVideo {
  return {
    autoplay: false,
    paused: true,
    seeking: false,
    currentTime: 0,
    duration: 5,
    played: { length: 0, start: () => 0, end: () => 0 },
    src: "https://environment.test/api/assets/signed/video.mp4?signature=example",
    ...overrides,
  };
}

describe("prepareVideoFirstFrame", () => {
  it("seeks a paused stream near its beginning without replacing its signed URL", () => {
    const video = previewVideo();
    const source = video.src;

    prepareVideoFirstFrame(video);

    expect(video.currentTime).toBe(0.1);
    expect(video.paused).toBe(true);
    expect(video.src).toBe(source);
  });

  it("keeps the preview seek inside a very short video", () => {
    const video = previewVideo({ duration: 0.05 });

    prepareVideoFirstFrame(video);

    expect(video.currentTime).toBe(0.025);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not seek a stream with duration %s",
    (duration) => {
      const video = previewVideo({ duration });

      prepareVideoFirstFrame(video);

      expect(video.currentTime).toBe(0);
    },
  );

  it.each<Partial<PreviewVideo>>([
    { autoplay: true },
    { paused: false },
    { seeking: true },
    { currentTime: 2 },
    { played: { length: 1, start: () => 0, end: () => 2 } },
  ])("does not interrupt existing playback or user seeking: %j", (state) => {
    const video = previewVideo(state);
    const position = video.currentTime;

    prepareVideoFirstFrame(video);

    expect(video.currentTime).toBe(position);
  });

  it.each(["#t=3", "#t=0,4", "#xywh=0,0,100,100&t=2", "#%74=3"])(
    "preserves an authored temporal fragment %s",
    (fragment) => {
      const video = previewVideo({ src: `https://environment.test/video.mp4${fragment}` });

      prepareVideoFirstFrame(video);

      expect(video.currentTime).toBe(0);
    },
  );

  it("does not confuse an encoded filename hash with a temporal fragment", () => {
    const video = previewVideo({ src: "https://environment.test/video%23t=3.mp4" });

    prepareVideoFirstFrame(video);

    expect(video.currentTime).toBe(0.1);
  });

  it("does not seek again when metadata is emitted after the initial preview", () => {
    const video = previewVideo();
    let position = 0;
    const seek = vi.fn((value: number) => {
      position = value;
    });
    Object.defineProperty(video, "currentTime", { get: () => position, set: seek });

    prepareVideoFirstFrame(video);
    prepareVideoFirstFrame(video);

    expect(seek).toHaveBeenCalledExactlyOnceWith(0.1);
  });

  it("tolerates a browser rejecting the preview seek", () => {
    const video = previewVideo();
    Object.defineProperty(video, "currentTime", {
      get: () => 0,
      set: () => {
        throw new Error("The stream is not seekable yet");
      },
    });

    expect(() => prepareVideoFirstFrame(video)).not.toThrow();
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(0);
  });
});
