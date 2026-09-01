import { useIsFocused } from "@react-navigation/native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, View } from "react-native";

import { loadMediaVideoSource } from "../lib/mediaVideoPlayback";
import { AppText } from "./AppText";
import { SymbolView } from "./AppSymbol";

/** Loads only after Play or opening the viewer. Source replacement never starts playback itself. */
function LoadedMediaVideo(props: {
  readonly uri: string;
  readonly playRequested: boolean;
  readonly paused: boolean;
}) {
  const focused = useIsFocused();
  const active = useRef(focused && AppState.currentState === "active");
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const player = useVideoPlayer(null, (player) => {
    player.staysActiveInBackground = false;
    player.bufferOptions = { preferredForwardBufferDuration: 5 };
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    active.current = focused && !props.paused && AppState.currentState === "active";
    if (!active.current) player.pause();
    const subscription = AppState.addEventListener("change", (state) => {
      active.current = focused && !props.paused && state === "active";
      if (!active.current) player.pause();
    });
    return () => subscription.remove();
  }, [focused, player, props.paused]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    void loadMediaVideoSource(player, {
      uri: props.uri,
      signal: controller.signal,
      playRequested: props.playRequested,
      isActive: () => active.current,
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [player, props.uri, props.playRequested, attempt]);

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        surfaceType="textureView"
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
      />
      {loadError || status === "error" ? (
        <View className="absolute inset-0 items-center justify-center gap-2 bg-black px-4">
          <AppText className="text-center text-sm text-white/80">Video unavailable</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry video"
            onPress={() => setAttempt((value) => value + 1)}
            className="min-h-11 justify-center px-4"
          >
            <AppText className="text-sm text-white">Retry</AppText>
          </Pressable>
        </View>
      ) : status === "loading" || status === "idle" ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <ActivityIndicator color="#ffffff" accessibilityLabel="Loading video" />
        </View>
      ) : null}
    </View>
  );
}

export function MediaVideoPlayer(props: {
  readonly uri: string | null;
  readonly name: string;
  readonly unavailable?: boolean;
  readonly expanded?: boolean;
  readonly paused?: boolean;
  readonly onExpand?: () => void;
}) {
  const [playbackUri, setPlaybackUri] = useState<string | null>(null);
  const uri = playbackUri ?? (props.expanded ? props.uri : null);

  return (
    <View
      collapsable={false}
      className="overflow-hidden rounded-[10px] bg-black"
      style={props.expanded ? { flex: 1 } : { width: "100%", maxWidth: 480, aspectRatio: 16 / 9 }}
    >
      {uri ? (
        <LoadedMediaVideo
          uri={uri}
          playRequested={playbackUri !== null}
          paused={props.paused ?? false}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Play ${props.name}`}
          accessibilityState={{ disabled: props.uri === null || props.unavailable === true }}
          disabled={props.uri === null || props.unavailable === true}
          onPress={() => setPlaybackUri(props.uri)}
          className="flex-1 items-center justify-center gap-2 px-4"
        >
          {props.unavailable ? (
            <AppText className="text-sm text-white/80">Video unavailable</AppText>
          ) : props.uri === null ? (
            <ActivityIndicator color="#ffffff" accessibilityLabel="Loading video" />
          ) : (
            <>
              <SymbolView name="play" size={28} tintColor="#ffffff" type="monochrome" />
              <AppText className="text-center text-xs text-white/80" numberOfLines={2}>
                {props.name}
              </AppText>
            </>
          )}
        </Pressable>
      )}
      {props.onExpand ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Expand ${props.name}`}
          onPress={() => {
            setPlaybackUri(null);
            props.onExpand?.();
          }}
          className="absolute right-1 top-1 min-h-11 min-w-11 items-center justify-center rounded-md bg-black/60 px-2"
        >
          <AppText className="text-xs text-white">Expand</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
