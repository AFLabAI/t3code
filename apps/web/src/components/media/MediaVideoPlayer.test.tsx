// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MediaVideoPlayer } from "./MediaVideoPlayer";

describe("MediaVideoPlayer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let intersect: (visible: boolean) => void;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = (visible) =>
            callback(
              [{ isIntersecting: visible } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
        }
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function video(): HTMLVideoElement {
    const element = container.querySelector("video");
    expect(element).not.toBeNull();
    return element!;
  }

  function button(label: string): HTMLButtonElement {
    const element = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(element).toBeDefined();
    return element!;
  }

  async function play() {
    const element = video();
    Object.defineProperty(element, "paused", { configurable: true, value: false });
    await act(() => element.dispatchEvent(new Event("play")));
  }

  async function pause() {
    const element = video();
    Object.defineProperty(element, "paused", { configurable: true, value: true });
    await act(() => element.dispatchEvent(new Event("pause")));
  }

  it("loads the initial frame only after approaching the viewport and stays paused", async () => {
    const src = "https://environment.test/signed/clip.mp4";
    await act(() => root.render(<MediaVideoPlayer src={src} label="Clip" />));
    const element = video();
    const playVideo = vi.spyOn(element, "play");
    Object.defineProperties(element, {
      duration: { configurable: true, value: 90 },
      played: { configurable: true, value: { length: 0 } },
      seeking: { configurable: true, value: false },
    });
    expect(element.preload).toBe("none");

    await act(() => intersect(false));
    expect(element.preload).toBe("none");
    await act(() => intersect(true));
    expect(element.preload).toBe("metadata");
    await act(() => element.dispatchEvent(new Event("loadedmetadata")));

    expect(element.currentTime).toBe(0.1);
    expect(element.paused).toBe(true);
    expect(element.src).toBe(src);
    expect(playVideo).not.toHaveBeenCalled();
  });

  it("preserves playback and paused position when a signed URL renews", async () => {
    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/first.mp4" label="Clip" />),
    );
    const element = video();
    element.currentTime = 12;
    await play();

    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/second.mp4" label="Clip" />),
    );
    expect(video()).toBe(element);
    expect(element.src).toBe("https://environment.test/first.mp4");
    expect(element.currentTime).toBe(12);

    await pause();
    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/third.mp4" label="Clip" />),
    );
    expect(element.src).toBe("https://environment.test/first.mp4");
    expect(element.currentTime).toBe(12);
  });

  it.each(["pause", "ended"])("defers workspace revisions until %s", async (eventName) => {
    await act(() =>
      root.render(
        <MediaVideoPlayer src="https://environment.test/first.mp4" label="Clip" revision={null} />,
      ),
    );
    await play();
    await act(() =>
      root.render(
        <MediaVideoPlayer
          src="https://environment.test/updated.mp4"
          label="Clip"
          revision="file-change"
        />,
      ),
    );
    expect(video().src).toBe("https://environment.test/first.mp4");
    // A repeat play event must retain the revision of the source actually playing.
    await play();
    Object.defineProperty(video(), eventName === "pause" ? "paused" : "ended", {
      configurable: true,
      value: true,
    });
    await act(() => video().dispatchEvent(new Event(eventName)));
    expect(video().src).toBe("https://environment.test/updated.mp4");
  });

  it("refreshes a paused video when the workspace changes", async () => {
    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/first.mp4" label="Clip" />),
    );
    await play();
    await pause();

    await act(() =>
      root.render(
        <MediaVideoPlayer
          src="https://environment.test/updated.mp4"
          label="Clip"
          revision="file-change"
        />,
      ),
    );
    expect(video().src).toBe("https://environment.test/updated.mp4");
  });

  it("tries a renewed URL when the pinned source fails", async () => {
    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/expired.mp4" label="Clip" />),
    );
    await play();
    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/renewed.mp4" label="Clip" />),
    );
    await act(() => video().dispatchEvent(new Event("error")));

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(video().src).toBe("https://environment.test/renewed.mp4");
  });

  it("keeps retry and original-page navigation after a metadata load failure", async () => {
    const src = "//cdn.example.com/clip.mov";
    await act(() => root.render(<MediaVideoPlayer src={src} originalUrl={src} label="Clip" />));
    await act(() => intersect(true));
    const failedVideo = video();
    await act(() => failedVideo.dispatchEvent(new Event("error")));

    expect(container.textContent).toContain("Video unavailable");
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Open original");
    expect(link?.getAttribute("href")).toBe(src);
    await act(() => button("Retry video").click());

    expect(video()).not.toBe(failedVideo);
    expect(video().getAttribute("src")).toBe(src);
    expect(video().paused).toBe(true);
  });

  it("re-mints an expired host capability before retrying without exposing an original link", async () => {
    let completeRefresh: (() => void) | undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeRefresh = resolve;
        }),
    );
    await act(() =>
      root.render(
        <MediaVideoPlayer
          src="https://environment.test/expired.mp4"
          label="Clip"
          onRetry={onRetry}
        />,
      ),
    );
    await act(() => video().dispatchEvent(new Event("error")));
    expect(container.querySelector("a")).toBeNull();

    await act(() => button("Retry video").click());
    expect(button("Retrying…").disabled).toBe(true);
    await act(() =>
      root.render(
        <MediaVideoPlayer
          src="https://environment.test/renewed.mp4"
          label="Clip"
          onRetry={onRetry}
        />,
      ),
    );
    await act(() => completeRefresh?.());

    expect(onRetry).toHaveBeenCalledOnce();
    expect(video().src).toBe("https://environment.test/renewed.mp4");
    expect(video().paused).toBe(true);
  });

  it("pauses hidden and unmounted videos", async () => {
    await act(() =>
      root.render(<MediaVideoPlayer src="https://environment.test/clip.mp4" label="Clip" />),
    );
    const pauseVideo = vi.spyOn(video(), "pause");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(pauseVideo).toHaveBeenCalledOnce();

    await act(() => root.render(null));
    expect(pauseVideo).toHaveBeenCalledTimes(2);
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(pauseVideo).toHaveBeenCalledTimes(2);
  });
});
