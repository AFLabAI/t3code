import type { AssetResource, ChatFileAttachment, EnvironmentId } from "@t3tools/contracts";

import type { DraftComposerFileAttachment } from "./composerImages";

export type MediaVideoPreviewSource = {
  readonly type: "media";
  readonly name: string;
  readonly mimeType: string;
  readonly sourceIdentifier?: string;
  readonly srcFragment?: string;
} & (
  | { readonly uri: string }
  | {
      readonly environmentId: EnvironmentId;
      readonly resource: Extract<AssetResource, { readonly _tag: "media-file" }>;
    }
);

/** Keeps thumbnails independent of refreshed asset signatures and scoped to their environment. */
export function mediaVideoThumbnailKey(source: MediaVideoPreviewSource): string {
  return JSON.stringify(
    "uri" in source
      ? ["media-video", source.uri]
      : [
          "media-video",
          source.environmentId,
          source.resource.threadId,
          source.resource.path,
          source.srcFragment ?? "",
        ],
  );
}

export type AttachmentVideoPreviewSource = (
  | { readonly type: "local"; readonly attachment: DraftComposerFileAttachment }
  | {
      readonly type: "remote";
      readonly environmentId: EnvironmentId;
      readonly attachment: ChatFileAttachment;
    }
) & { readonly sourceIdentifier?: string };

export type VideoPreviewSource = AttachmentVideoPreviewSource | MediaVideoPreviewSource;
