import type { MenuAction } from "@react-native-menu/menu";
import { Alert } from "react-native";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import type { ThreadPrPresentation } from "../../state/thread-pr-presentation";

export function buildThreadPullRequestMenuItems(
  pullRequest: ThreadPrPresentation | null,
): MenuAction[] {
  if (pullRequest === null) return [];

  return [
    {
      id: "open-pull-request",
      title: `Open ${pullRequest.longName} #${pullRequest.number}`,
      image: "arrow.up.right",
    },
  ];
}

export async function openThreadPullRequest(
  pullRequest: ThreadPrPresentation | null,
): Promise<void> {
  if (pullRequest === null) return;

  if (!(await tryOpenExternalUrl(pullRequest.url, "pull-request"))) {
    Alert.alert(
      `Unable to open ${pullRequest.longName}`,
      `The ${pullRequest.longName} could not be opened.`,
    );
  }
}
