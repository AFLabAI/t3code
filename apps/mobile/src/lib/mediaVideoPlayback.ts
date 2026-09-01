import type { VideoPlayer } from "expo-video";

/** Opens a progressive stream paused, honoring a Play request only while its viewer is still active. */
export async function loadMediaVideoSource(
  player: Pick<VideoPlayer, "pause" | "play" | "replaceAsync">,
  input: {
    readonly uri: string;
    readonly signal: AbortSignal;
    readonly playRequested: boolean;
    readonly isActive: () => boolean;
  },
): Promise<void> {
  if (input.signal.aborted) return;
  player.pause();
  await player.replaceAsync({ uri: input.uri, contentType: "progressive" });
  if (!input.signal.aborted && input.playRequested && input.isActive()) player.play();
}
