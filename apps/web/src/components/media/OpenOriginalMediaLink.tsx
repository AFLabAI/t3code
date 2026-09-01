import { ExternalLinkIcon } from "lucide-react";

import { resolveExternalWebLinkHost } from "../chat/externalLinkContextMenu";
import { Button } from "../ui/button";

/** Offers the authored remote destination, never a generated asset capability. */
export function OpenOriginalMediaLink(props: {
  readonly url?: string | undefined;
  readonly className?: string | undefined;
}) {
  if (!props.url || resolveExternalWebLinkHost(props.url) === null) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      className={props.className}
      render={<a href={props.url} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLinkIcon />
      Open original
    </Button>
  );
}
