// @vitest-environment happy-dom

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { loadMediaVideoSource } from "./mediaVideoPlayback";
import type { AssetUrlState } from "../state/assets";
import type { VideoPreviewSource } from "./videoPreviewSource";

const native = vi.hoisted(() => ({
  createPlayer: vi.fn(() => ({
    status: "readyToPlay",
    currentTime: 0,
    pause: vi.fn(),
    play: vi.fn(),
    replaceAsync: vi.fn(async () => {}),
    release: vi.fn(),
    staysActiveInBackground: false,
    bufferOptions: {},
  })),
  asset: { _tag: "Loading" } as AssetUrlState,
  assetRequests: [] as Array<readonly [unknown, unknown]>,
  refreshUrl: vi.fn(async (): Promise<string | null> => null),
  share: vi.fn(async () => {}),
}));

vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("expo", () => ({
  useEvent: (player: { readonly status: string }) => ({ status: player.status }),
}));
vi.mock("expo-video", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useVideoPlayer: (
      _source: unknown,
      setup: (player: ReturnType<typeof native.createPlayer>) => void,
    ) => {
      const [player] = useState(() => {
        const player = native.createPlayer();
        setup(player);
        return player;
      });
      useEffect(() => () => player.release(), [player]);
      return player;
    },
    VideoView: () => null,
  };
});
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const Container = ({ children }: { readonly children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    Modal: Container,
    View: Container,
    Pressable: (props: {
      readonly accessibilityLabel?: string;
      readonly children?: ReactNode;
      readonly disabled?: boolean;
      readonly onPress?: () => void;
    }) =>
      createElement(
        "button",
        {
          "aria-label": props.accessibilityLabel,
          disabled: props.disabled,
          onClick: props.onPress,
        },
        props.children,
      ),
    ActivityIndicator: () => null,
    Keyboard: { dismiss: vi.fn() },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("../components/AppText", async () => {
  const { createElement } = await import("react");
  return {
    AppText: ({ children }: { readonly children?: ReactNode }) =>
      createElement("span", null, children),
  };
});
vi.mock("../components/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../components/VideoThumbnailImage", () => ({ VideoThumbnailImage: () => null }));
vi.mock("../state/assets", () => ({
  useAssetUrlState: (environmentId: unknown, resource: unknown) => {
    native.assetRequests.push([environmentId, resource]);
    return native.asset;
  },
  useRefreshAssetUrl: () => native.refreshUrl,
}));
vi.mock("../state/session", () => ({ usePreparedConnection: () => ({ _tag: "Some" }) }));
vi.mock("./attachmentDownload", () => ({ downloadAndShareAttachment: native.share }));
vi.mock("../components/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../components/VideoPreviewModal", async () => {
  const { createElement } = await import("react");
  const { MediaVideoPreviewModal } = await import("../components/MediaVideoPreviewModal");
  return {
    VideoPreviewModal: (props: {
      readonly source: VideoPreviewSource | null;
      readonly onRequestClose: () => void;
    }) =>
      props.source?.type === "media"
        ? createElement(MediaVideoPreviewModal, {
            source: props.source,
            onRequestClose: props.onRequestClose,
          })
        : null,
  };
});

import { MediaVideoPlayer } from "../components/MediaVideoPlayer";
import { MediaVideoPreviewModal } from "../components/MediaVideoPreviewModal";
import { WorkspaceFileVideoPreview } from "../features/files/WorkspaceFileVideoPreview";

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

describe("mobile video URL renewal", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    native.createPlayer.mockClear();
    native.share.mockClear();
    native.asset = { _tag: "Loading" };
    native.assetRequests = [];
    native.refreshUrl
      .mockReset()
      .mockImplementation(async () => (native.asset._tag === "Success" ? native.asset.url : null));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (element: ReactNode) => act(() => root.render(element));
  const click = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(() => button.click());
  };
  const latestPlayer = () => {
    const player = native.createPlayer.mock.results.at(-1)?.value;
    if (!player) throw new Error("Expected a native video player");
    return player;
  };
  const modal = () =>
    createElement(MediaVideoPreviewModal, {
      source: {
        type: "media",
        environmentId: EnvironmentId.make("environment"),
        resource: {
          _tag: "media-file",
          threadId: ThreadId.make("thread"),
          path: "/tmp/clip.mp4",
        },
        name: "clip.mp4",
        mimeType: "video/mp4",
        srcFragment: "#t=2",
      },
      onRequestClose: vi.fn(),
    });

  it("preserves playback on renewal and uses the fresh URL for sharing and Retry", async () => {
    native.asset = { _tag: "Success", url: "https://host/initial/clip.mp4" };
    await render(modal());
    const player = latestPlayer();
    expect(player.replaceAsync).toHaveBeenCalledExactlyOnceWith({
      uri: "https://host/initial/clip.mp4#t=2",
      contentType: "progressive",
    });
    player.currentTime = 42;
    player.play();
    player.pause.mockClear();

    native.asset = { _tag: "Success", url: "https://host/refreshed/clip.mp4" };
    await render(modal());
    expect(native.createPlayer).toHaveBeenCalledTimes(1);
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.currentTime).toBe(42);
    expect(native.refreshUrl).toHaveBeenCalledTimes(1);

    native.refreshUrl.mockResolvedValueOnce("https://host/share/clip.mp4");
    await click("Save or share video");
    expect(native.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://host/share/clip.mp4#t=2" }),
    );

    player.status = "error";
    await render(modal());
    await click("Retry video");
    expect(player.replaceAsync).toHaveBeenLastCalledWith({
      uri: "https://host/refreshed/clip.mp4#t=2",
      contentType: "progressive",
    });
    expect(player.replaceAsync).toHaveBeenCalledTimes(2);
    expect(native.refreshUrl).toHaveBeenCalledTimes(3);
  });

  it("remints a capability on Retry instead of reusing the cached URL of a replaced file", async () => {
    native.asset = { _tag: "Success", url: "https://host/old-inode/clip.mp4" };
    await render(modal());
    const player = latestPlayer();
    player.status = "error";
    native.refreshUrl.mockResolvedValueOnce("https://host/new-inode/clip.mp4");
    await render(modal());
    await click("Retry video");
    expect(player.replaceAsync).toHaveBeenLastCalledWith({
      uri: "https://host/new-inode/clip.mp4#t=2",
      contentType: "progressive",
    });
  });

  it("does not load a capability after its viewer closes while signing", async () => {
    native.asset = { _tag: "Success", url: "https://host/cached/clip.mp4" };
    const signing = Promise.withResolvers<string | null>();
    native.refreshUrl.mockReturnValueOnce(signing.promise);
    await render(modal());
    const player = latestPlayer();
    await render(null);
    await act(async () => signing.resolve("https://host/refreshed/clip.mp4"));
    expect(player.replaceAsync).not.toHaveBeenCalled();
  });

  it("does not reuse an old capability when reauthorization fails", async () => {
    native.asset = { _tag: "Success", url: "https://host/removed/clip.mp4" };
    await render(modal());
    const player = latestPlayer();
    player.status = "error";
    native.refreshUrl.mockResolvedValueOnce(null);
    await render(modal());
    await click("Retry video");
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Video unavailable");
  });

  it("keeps the environment resource when expanding a workspace video", async () => {
    native.asset = { _tag: "Success", url: "https://host/cached/clip.mp4" };
    native.refreshUrl.mockResolvedValue("https://host/reminted/clip.mp4");
    const environmentId = EnvironmentId.make("file-environment");
    const resource = {
      _tag: "media-file" as const,
      threadId: ThreadId.make("file-thread"),
      path: "/repo/clip#one%20.mp4",
    };
    await render(
      createElement(WorkspaceFileVideoPreview, {
        name: "clip#one%20.mp4",
        thumbnailKey: "workspace:clip",
        uri: native.asset.url,
        source: {
          type: "media",
          environmentId,
          resource,
          name: "clip#one%20.mp4",
          mimeType: "video/mp4",
        },
        resolvePlaybackUri: native.refreshUrl,
        unavailable: false,
      }),
    );
    await click("Expand clip#one%20.mp4");
    expect(native.assetRequests).toContainEqual([environmentId, resource]);
    expect(latestPlayer().replaceAsync).toHaveBeenCalledExactlyOnceWith({
      uri: "https://host/reminted/clip.mp4",
      contentType: "progressive",
    });
  });

  it("retains an expanded player through signing failures and disables sharing until recovery", async () => {
    await render(modal());
    expect(native.createPlayer).not.toHaveBeenCalled();
    native.asset = { _tag: "Success", url: "https://host/initial/clip.mp4" };
    await render(modal());
    const player = latestPlayer();
    player.currentTime = 42;

    for (const asset of [{ _tag: "Loading" }, { _tag: "Failure" }] as const) {
      native.asset = asset;
      await render(modal());
      expect(player.release).not.toHaveBeenCalled();
      expect(
        container.querySelector<HTMLButtonElement>('[aria-label="Save or share video"]')?.disabled,
      ).toBe(true);
    }

    native.asset = { _tag: "Success", url: "https://host/recovered/clip.mp4" };
    await render(modal());
    expect(native.createPlayer).toHaveBeenCalledTimes(1);
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(42);
    await click("Save or share video");
    expect(native.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://host/recovered/clip.mp4#t=2" }),
    );
  });

  it("retries an inline video with the latest signed URL without restarting on renewal", async () => {
    let authorizedUri = "https://host/initial/clip.mp4";
    const resolvePlaybackUri = vi.fn(async () => authorizedUri);
    const inline = (uri: string) =>
      createElement(MediaVideoPlayer, {
        uri,
        name: "clip.mp4",
        thumbnailKey: "environment:clip",
        resolvePlaybackUri,
      });
    await render(inline("https://host/initial/clip.mp4"));
    await click("Play clip.mp4");
    const player = latestPlayer();
    expect(player.play).toHaveBeenCalledTimes(1);
    player.currentTime = 42;
    await render(inline("https://host/refreshed/clip.mp4"));
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(42);
    expect(resolvePlaybackUri).toHaveBeenCalledTimes(1);

    player.status = "error";
    authorizedUri = "https://host/new-inode/clip.mp4";
    await render(inline("https://host/refreshed/clip.mp4"));
    await click("Retry video");
    expect(player.replaceAsync).toHaveBeenLastCalledWith({
      uri: "https://host/new-inode/clip.mp4",
      contentType: "progressive",
    });
    expect(resolvePlaybackUri).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "resets the native player for another media identity, expanded=%s",
    async (expanded) => {
      const video = (name: string) =>
        createElement(MediaVideoPlayer, {
          uri: `https://host/${name}`,
          name,
          thumbnailKey: `environment:${name}`,
          expanded,
        });
      await render(video("first.mp4"));
      if (!expanded) await click("Play first.mp4");
      const first = latestPlayer();
      first.currentTime = 42;
      await render(video("second.mp4"));
      expect(first.release).toHaveBeenCalledOnce();
      if (!expanded) {
        expect(native.createPlayer).toHaveBeenCalledTimes(1);
        await click("Play second.mp4");
      }
      const second = latestPlayer();
      expect(second).not.toBe(first);
      expect(second.replaceAsync).toHaveBeenCalledExactlyOnceWith({
        uri: "https://host/second.mp4",
        contentType: "progressive",
      });
      expect(second.play).toHaveBeenCalledTimes(expanded ? 0 : 1);
    },
  );
});
