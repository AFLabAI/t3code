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

interface CachedMobileTurnAttachments {
  readonly sourceAttachments: ReadonlyArray<TurnAttachment>;
  readonly prepared: PreparedMobileTurnAttachments;
  readonly previous?: CachedMobileTurnAttachments;
  preparation: Promise<PreparedMobileTurnAttachments> | null;
  released: boolean;
}

const preparedAttachmentsByEnvironment = new Map<
  EnvironmentId,
  Map<string, CachedMobileTurnAttachments>
>();

/** Releases uploads retained for one queued turn or for every turn in an environment. */
export async function releaseMobileTurnAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly commandId?: string;
}): Promise<void> {
  const commands = preparedAttachmentsByEnvironment.get(input.environmentId);
  if (!commands) {
    return;
  }
  const matching = new Set<CachedMobileTurnAttachments>();
  const current =
    input.commandId === undefined ? commands.values() : [commands.get(input.commandId)];
  for (const entry of current) {
    for (let candidate = entry; candidate; candidate = candidate.previous) {
      matching.add(candidate);
    }
  }
  await Promise.allSettled([...matching].map((entry) => entry.prepared.release()));
}

function sameAttachments(
  left: ReadonlyArray<TurnAttachment>,
  right: ReadonlyArray<TurnAttachment>,
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        attachment.name === other.name &&
        attachment.mimeType === other.mimeType &&
        attachment.sizeBytes === other.sizeBytes &&
        ("dataUrl" in attachment
          ? "dataUrl" in other && attachment.dataUrl === other.dataUrl
          : "id" in other && attachment.id === other.id)
      );
    })
  );
}

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

  const environmentCommands = preparedAttachmentsByEnvironment.get(input.environmentId);
  const existing =
    input.commandId === undefined ? undefined : environmentCommands?.get(input.commandId);
  if (existing) {
    if (sameAttachments(existing.sourceAttachments, input.attachments)) {
      return existing.preparation ?? existing.prepared;
    }
  }

  const pendingAttachmentIds = new Set<string>();
  const controller = new AbortController();
  let releasePromise: Promise<void> | null = null;
  let entry: CachedMobileTurnAttachments;
  const release = async (): Promise<void> => {
    if (releasePromise !== null) {
      return releasePromise;
    }
    entry.released = true;
    controller.abort();
    if (input.commandId !== undefined) {
      const commands = preparedAttachmentsByEnvironment.get(input.environmentId);
      if (commands?.get(input.commandId) === entry) {
        if (entry.previous && !entry.previous.released) {
          commands.set(input.commandId, entry.previous);
        } else {
          commands.delete(input.commandId);
        }
        if (commands.size === 0) {
          preparedAttachmentsByEnvironment.delete(input.environmentId);
        }
      }
    }
    const attachmentIds = [...pendingAttachmentIds];
    pendingAttachmentIds.clear();
    releasePromise = Promise.allSettled(
      attachmentIds.map((attachmentId) => input.deleteUpload(attachmentId)),
    ).then(() => undefined);
    return releasePromise;
  };
  const uploadedAttachments: TurnAttachment[] = [];
  const prepared = { attachments: uploadedAttachments, release };
  entry = {
    sourceAttachments: input.attachments,
    prepared,
    ...(existing ? { previous: existing } : {}),
    preparation: null,
    released: false,
  };
  if (input.commandId !== undefined) {
    const commands = environmentCommands ?? new Map<string, CachedMobileTurnAttachments>();
    preparedAttachmentsByEnvironment.set(input.environmentId, commands);
    commands.set(input.commandId, entry);
  }

  const runPreparation = async (): Promise<PreparedMobileTurnAttachments> => {
    const { File: ExpoFile, Paths } = await import("expo-file-system");
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
        if (entry.released) {
          await Promise.allSettled([input.deleteUpload(upload.attachmentId)]);
          throw new ConnectionTransientError({
            reason: "transport",
            detail: `Image upload for '${attachment.name}' was cancelled.`,
          });
        }
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
          signal: controller.signal,
        });
        if (result.status < 200 || result.status >= 300) {
          const detail = `Could not upload '${attachment.name}': upload rejected (${result.status}).`;
          if (result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status)) {
            throw new ConnectionBlockedError({
              reason:
                result.status === 401 || result.status === 403 ? "permission" : "configuration",
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

    if (existing) {
      await existing.prepared.release();
    }
    return prepared;
  };
  entry.preparation = runPreparation().catch(async (cause: unknown) => {
    await release();
    if (cause instanceof ConnectionBlockedError || cause instanceof ConnectionTransientError) {
      throw cause;
    }
    throw transientUploadError(input.attachments[0]?.name ?? "image", cause);
  });
  return entry.preparation;
}
