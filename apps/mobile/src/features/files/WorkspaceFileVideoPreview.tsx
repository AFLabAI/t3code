import { useState } from "react";
import { View } from "react-native";
import { videoMimeType } from "@t3tools/shared/video";

import { EmptyState } from "../../components/EmptyState";
import { MediaVideoPlayer } from "../../components/MediaVideoPlayer";
import { VideoPreviewModal, type VideoPreviewSource } from "../../components/VideoPreviewModal";

/** Uses the signed progressive URL directly; choosing a file never preloads its video bytes as text. */
export function WorkspaceFileVideoPreview(props: {
  readonly name: string;
  readonly thumbnailKey: string;
  readonly uri: string | null;
  readonly unavailable: boolean;
}) {
  const [preview, setPreview] = useState<VideoPreviewSource | null>(null);
  const uri = props.uri;

  if (props.unavailable) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet px-6">
        <EmptyState
          title="Video unavailable"
          detail="This file may be missing, unsupported, or unavailable on this environment."
        />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-sheet p-4">
      <MediaVideoPlayer
        uri={uri}
        name={props.name}
        thumbnailKey={props.thumbnailKey}
        onExpand={
          uri === null
            ? undefined
            : () =>
                setPreview({
                  type: "media",
                  uri,
                  name: props.name,
                  mimeType: videoMimeType({ name: props.name, mimeType: "" }) ?? "video/mp4",
                })
        }
      />
      <VideoPreviewModal source={preview} onRequestClose={() => setPreview(null)} />
    </View>
  );
}
