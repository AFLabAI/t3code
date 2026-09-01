import { useEffect, useRef, useState } from "react";
import { Keyboard, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { downloadAndShareAttachment } from "../lib/attachmentDownload";
import type { MediaVideoPreviewSource } from "../lib/videoPreviewSource";
import { useAssetUrlState } from "../state/assets";
import { usePreparedConnection } from "../state/session";
import { AppText } from "./AppText";
import { SymbolView } from "./AppSymbol";
import { MediaVideoPlayer } from "./MediaVideoPlayer";

/** Media files stream in place. A client-side copy is made only for an explicit share. */
export function MediaVideoPreviewModal(props: {
  readonly source: MediaVideoPreviewSource;
  readonly onRequestClose: () => void;
}) {
  const { source } = props;
  const insets = useSafeAreaInsets();
  const environmentId = "environmentId" in source ? source.environmentId : null;
  const connection = usePreparedConnection(environmentId);
  const asset = useAssetUrlState(environmentId, "resource" in source ? source.resource : null);
  const [uri, setUri] = useState<string | null>("uri" in source ? source.uri : null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareController = useRef<AbortController | null>(null);
  const unavailable =
    uri === null &&
    environmentId !== null &&
    (connection._tag === "None" || asset._tag === "Failure");

  useEffect(() => Keyboard.dismiss(), []);
  useEffect(() => {
    if (uri === null && asset._tag === "Success") setUri(asset.url + (source.srcFragment ?? ""));
  }, [uri, asset, source.srcFragment]);
  useEffect(() => () => shareController.current?.abort(), []);

  const share = () => {
    if (uri === null || shareController.current) return;
    const controller = new AbortController();
    shareController.current = controller;
    setSharing(true);
    setShareError(null);
    void downloadAndShareAttachment({
      url: uri,
      attachment: { name: source.name, mimeType: source.mimeType },
      signal: controller.signal,
      sourceIdentifier: source.sourceIdentifier,
    })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setShareError(error instanceof Error ? error.message : "Could not share this video.");
        }
      })
      .finally(() => {
        if (shareController.current === controller) {
          shareController.current = null;
          if (!controller.signal.aborted) setSharing(false);
        }
      });
  };

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={props.onRequestClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        className="flex-1 bg-black"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="min-h-14 flex-row items-center gap-3 pl-4 pr-2">
          <AppText className="flex-1 font-t3-medium text-base text-white" numberOfLines={2}>
            {source.name}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close video"
            onPress={props.onRequestClose}
            className="size-12 items-center justify-center"
          >
            <SymbolView name="xmark" size={20} tintColor="#ffffff" type="monochrome" />
          </Pressable>
        </View>
        <MediaVideoPlayer
          uri={uri}
          name={source.name}
          unavailable={unavailable}
          paused={sharing}
          expanded
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save or share video"
          disabled={uri === null || sharing}
          onPress={share}
          className="mx-4 my-3 min-h-12 items-center justify-center rounded-xl bg-white/15 px-4"
        >
          <AppText className="font-t3-medium text-base text-white">
            {sharing ? "Opening share sheet..." : "Save or share video"}
          </AppText>
        </Pressable>
        {shareError ? (
          <AppText accessibilityRole="alert" className="px-4 pb-3 text-sm text-white/80">
            {shareError}
          </AppText>
        ) : null}
      </View>
    </Modal>
  );
}
