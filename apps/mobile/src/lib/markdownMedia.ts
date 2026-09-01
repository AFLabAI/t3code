import {
  classifyMarkdownImageSource,
  markdownImageSourceFragment,
} from "@t3tools/client-runtime/markdown-images";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { normalizeNativeMarkdownUrl } from "@t3tools/mobile-markdown-text/links";
import { mediaMimeType, mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";

import type { FilePreviewSource } from "../components/FilePreviewModal";
import type { MediaVideoPreviewSource } from "./videoPreviewSource";

/** Resolves only explicit media references. Ordinary links keep their existing navigation. */
export function resolveMarkdownMediaPreview(
  href: string,
  input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly workspaceRoot: string | null | undefined;
  },
):
  | { readonly kind: "image"; readonly source: FilePreviewSource }
  | { readonly kind: "video"; readonly source: MediaVideoPreviewSource }
  | null {
  const classified = classifyMarkdownImageSource(href, input.workspaceRoot);
  if (classified._tag === "Blocked") return null;
  const path =
    classified._tag === "WorkspaceFile"
      ? classified.path.replace(/:\d+(?::\d+)?$/, "")
      : classified.uri.split(/[?#]/, 1)[0]!;
  const basename = path.split(/[\\/]/).at(-1) ?? "";
  const extensionIndex = basename.lastIndexOf(".");
  // Local paths have already been decoded. Do not interpret literal #, ?, or % characters again.
  const mimeType =
    classified._tag === "Direct"
      ? mediaMimeType(classified.uri)
      : extensionIndex < 0
        ? null
        : mediaMimeTypeFromExtension(basename.slice(extensionIndex));
  if (mimeType === null) return null;
  const kind = mimeType.startsWith("video/") ? "video" : "image";
  const name = basename || (kind === "video" ? "Video" : "Image");
  const srcFragment = markdownImageSourceFragment(href);
  const target =
    classified._tag === "Direct"
      ? { uri: normalizeNativeMarkdownUrl(classified.uri) }
      : {
          environmentId: input.environmentId,
          resource: {
            _tag: "media-file" as const,
            threadId: input.threadId,
            path,
          },
          ...(srcFragment ? { srcFragment } : {}),
        };
  return kind === "video"
    ? {
        kind,
        source: { type: "media", name, mimeType, ...target },
      }
    : {
        kind,
        source: { kind, name, ...target },
      };
}
