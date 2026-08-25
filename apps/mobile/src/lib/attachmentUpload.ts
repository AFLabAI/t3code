import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type AttachmentCreateUploadUrlInput,
  type AttachmentCreateUploadUrlResult,
  type ChatAttachment,
  type EnvironmentId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import type { File } from "expo-file-system";

type TurnAttachment = ChatAttachment | UploadChatAttachment;

interface MobileAttachmentUploadInput {
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string | null;
  readonly supportsUploads: boolean;
  readonly attachments: ReadonlyArray<TurnAttachment>;
  readonly createUploadUrl: (
    input: AttachmentCreateUploadUrlInput,
  ) => Promise<AttachmentCreateUploadUrlResult>;
  readonly deleteUpload: (attachmentId: string) => Promise<void>;
}

interface PreparedMobileTurnAttachments {
  readonly attachments: ReadonlyArray<TurnAttachment>;
  readonly release: () => Promise<void>;
}

function transientUploadError(name: string, cause: unknown): ConnectionTransientError {
  const reason = cause instanceof Error ? cause.message : "upload failed";
  return new ConnectionTransientError({
    reason: "network",
    detail: `Could not upload '${name}': ${reason.replace(/\.$/, "")}.`,
  });
}

/** Uploads mobile images as native binary requests and keeps old servers on the inline format. */
export async function prepareMobileTurnAttachments(
  input: MobileAttachmentUploadInput,
): Promise<PreparedMobileTurnAttachments> {
  if (!input.supportsUploads || input.attachments.length === 0) {
    return { attachments: input.attachments, release: async () => undefined };
  }

  const { File: ExpoFile, Paths } = await import("expo-file-system");
  const pendingAttachmentIds = new Set<string>();
  const release = async (): Promise<void> => {
    const attachmentIds = [...pendingAttachmentIds];
    pendingAttachmentIds.clear();
    await Promise.allSettled(attachmentIds.map((attachmentId) => input.deleteUpload(attachmentId)));
  };
  const uploadedAttachments: TurnAttachment[] = [];

  for (const attachment of input.attachments) {
    if (!("dataUrl" in attachment)) {
      uploadedAttachments.push(attachment);
      continue;
    }

    let temporaryFile: File | null = null;
    try {
      if (input.httpBaseUrl === null) {
        throw new Error("environment is not connected");
      }
      const mimeType = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
        (supportedMimeType) => supportedMimeType === attachment.mimeType.toLowerCase(),
      );
      if (!mimeType) {
        throw new Error("image type is not supported");
      }

      const upload = await input.createUploadUrl({
        name: attachment.name,
        mimeType,
        sizeBytes: attachment.sizeBytes,
      });
      pendingAttachmentIds.add(upload.attachmentId);

      const url = resolveAssetUrl(input.httpBaseUrl, upload.relativeUrl);
      if (url === null) {
        throw new Error("upload URL is invalid");
      }

      const separatorIndex = attachment.dataUrl.indexOf(",");
      if (separatorIndex < 0) {
        throw new Error("image data is invalid");
      }
      temporaryFile = new ExpoFile(Paths.cache, `t3-attachment-${upload.attachmentId}`);
      temporaryFile.write(attachment.dataUrl.slice(separatorIndex + 1), { encoding: "base64" });

      const result = await temporaryFile.upload(url, {
        httpMethod: "POST",
        headers: { "Content-Type": mimeType },
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`upload rejected (${result.status})`);
      }

      uploadedAttachments.push({
        type: "image",
        id: upload.attachmentId,
        name: attachment.name,
        mimeType,
        sizeBytes: attachment.sizeBytes,
      });
    } catch (cause) {
      await release();
      throw transientUploadError(attachment.name, cause);
    } finally {
      if (temporaryFile?.exists) {
        try {
          temporaryFile.delete();
        } catch (cause) {
          console.warn("Failed to remove temporary attachment upload", cause);
        }
      }
    }
  }

  return { attachments: uploadedAttachments, release };
}
