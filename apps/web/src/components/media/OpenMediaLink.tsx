import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { resolveExternalWebLinkHost } from "../chat/externalLinkContextMenu";
import { Button } from "../ui/button";

/** Navigates directly so the browser handles video playback and downloads, without fetching bytes. */
export function OpenMediaLink(props: {
  readonly originalUrl?: string | undefined;
  readonly src?: string | null | undefined;
  readonly fileName?: string | undefined;
  readonly className?: string | undefined;
}) {
  const originalUrl =
    resolveExternalWebLinkHost(props.originalUrl) !== null ? props.originalUrl : undefined;
  let url = originalUrl ?? props.src;
  if (!url) return null;
  let isBlob = false;
  try {
    // A desktop renderer's app scheme must not leak into protocol-relative web links.
    if (url.startsWith("//")) {
      const protocol =
        typeof window !== "undefined" && window.location.protocol === "http:" ? "http:" : "https:";
      url = `${protocol}${url}`;
    }
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:" && protocol !== "blob:") return null;
    isBlob = protocol === "blob:";
  } catch {
    return null;
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      className={props.className}
      render={
        <a
          href={url}
          target={isBlob ? undefined : "_blank"}
          download={isBlob ? props.fileName || true : undefined}
          rel="noopener noreferrer"
        />
      }
    >
      {isBlob ? <DownloadIcon /> : <ExternalLinkIcon />}
      {originalUrl ? "Open original" : isBlob ? "Download video" : "Open in browser"}
    </Button>
  );
}
