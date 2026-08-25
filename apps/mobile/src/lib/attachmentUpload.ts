import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type AttachmentCreateUploadUrlInput,
  type AttachmentCreateUploadUrlResult,
  type ChatAttachment,
  type EnvironmentId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import type { File } from "expo-file-system";

import { estimateBase64ByteSize } from "./base64";

type TurnAttachment = ChatAttachment | UploadChatAttachment;

interface MobileAttachmentUploadInput {
  readonly environmentId: EnvironmentId;
  readonly commandId?: string;
  readonly httpBaseUrl: string | null;
  readonly supportsUploads: boolean | null;
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

const preparedAttachmentsByCommand = new Map<string, PreparedMobileTurnAttachments>();

function transientUploadError(name: string, cause: unknown): ConnectionTransientError {
  console.warn("Image attachment upload failed.", { attachmentName: name, cause });
  return new ConnectionTransientError({
    reason: "network",
    detail: `Could not upload '${name}'.`,
  });
}

/** Uploads mobile images as native binary requests before their turn is sent. */
export async function prepareMobileTurnAttachments(
  input: MobileAttachmentUploadInput,
): Promise<PreparedMobileTurnAttachments> {
  if (input.attachments.length === 0) {
    return { attachments: input.attachments, release: async () => undefined };
  }
  if (input.supportsUploads === null) {
    throw new ConnectionTransientError({
      reason: "endpoint-unavailable",
      detail: "Environment upload capabilities are still loading.",
    });
  }
  if (!input.supportsUploads) {
    throw new ConnectionBlockedError({
      reason: "unsupported",
      detail: "Image attachments require an updated environment.",
    });
  }

  const commandKey =
    input.commandId === undefined ? null : `${input.environmentId}:${input.commandId}`;
  const existing = commandKey === null ? undefined : preparedAttachmentsByCommand.get(commandKey);
  if (existing) {
    return existing;
  }

  const { File: ExpoFile, Paths } = await import("expo-file-system");
  const pendingAttachmentIds = new Set<string>();
  const release = async (): Promise<void> => {
    if (commandKey !== null) {
      preparedAttachmentsByCommand.delete(commandKey);
    }
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
        throw new ConnectionTransientError({
          reason: "endpoint-unavailable",
          detail: `Could not upload '${attachment.name}': environment is not connected.`,
        });
      }
      const mimeType = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
        (supportedMimeType) => supportedMimeType === attachment.mimeType.toLowerCase(),
      );
      if (!mimeType) {
        throw new ConnectionBlockedError({
          reason: "unsupported",
          detail: `Could not upload '${attachment.name}': image type is not supported.`,
        });
      }
      const separatorIndex = attachment.dataUrl.indexOf(",");
      const base64 = attachment.dataUrl.slice(separatorIndex + 1);
      const sizeBytes = estimateBase64ByteSize(base64);
      if (
        separatorIndex < 0 ||
        !attachment.dataUrl.slice(0, separatorIndex).endsWith(";base64") ||
        sizeBytes <= 0 ||
        sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
      ) {
        throw new ConnectionBlockedError({
          reason: "configuration",
          detail: `Could not upload '${attachment.name}': image data is invalid.`,
        });
      }

      const upload = await input.createUploadUrl({
        name: attachment.name,
        mimeType,
        sizeBytes,
      });
      pendingAttachmentIds.add(upload.attachmentId);

      const url = resolveAssetUrl(input.httpBaseUrl, upload.relativeUrl);
      if (url === null) {
        throw new ConnectionBlockedError({
          reason: "configuration",
          detail: `Could not upload '${attachment.name}': upload URL is invalid.`,
        });
      }
      temporaryFile = new ExpoFile(Paths.cache, `t3-attachment-${upload.attachmentId}`);
      temporaryFile.write(base64, { encoding: "base64" });

      const result = await temporaryFile.upload(url, {
        httpMethod: "POST",
        headers: { "Content-Type": mimeType },
      });
      if (result.status < 200 || result.status >= 300) {
        const detail = `Could not upload '${attachment.name}': upload rejected (${result.status}).`;
        if (result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status)) {
          throw new ConnectionBlockedError({
            reason: result.status === 401 || result.status === 403 ? "permission" : "configuration",
            detail,
          });
        }
        throw new ConnectionTransientError({ reason: "network", detail });
      }

      uploadedAttachments.push({
        type: "image",
        id: upload.attachmentId,
        name: attachment.name,
        mimeType,
        sizeBytes,
      });
    } catch (cause) {
      await release();
      throw cause instanceof ConnectionBlockedError || cause instanceof ConnectionTransientError
        ? cause
        : transientUploadError(attachment.name, cause);
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

  const prepared = { attachments: uploadedAttachments, release };
  if (commandKey !== null) {
    preparedAttachmentsByCommand.set(commandKey, prepared);
  }
  return prepared;
}
