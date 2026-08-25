import type { VcsStatusResult } from "@t3tools/contracts";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { presentThreadPr } from "../../state/thread-pr-presentation";
import { buildThreadPullRequestMenuItems, openThreadPullRequest } from "./thread-pull-request-menu";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
}));

vi.mock("../../lib/openExternalUrl", () => ({
  tryOpenExternalUrl: vi.fn(),
}));

const pullRequest: NonNullable<VcsStatusResult["pr"]> = {
  number: 42,
  title: "Linked pull request",
  url: "https://github.com/pingdotgg/t3code/pull/42",
  baseRef: "main",
  headRef: "another-branch",
  state: "open",
};

const openExternalUrl = vi.mocked(tryOpenExternalUrl);
const showAlert = vi.mocked(Alert.alert);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildThreadPullRequestMenuItems", () => {
  it("hides the action when the thread has no pull request", () => {
    expect(buildThreadPullRequestMenuItems(null)).toEqual([]);
  });

  it.each(["open", "merged", "closed"] as const)(
    "offers the browser action for a %s pull request",
    (state) => {
      expect(
        buildThreadPullRequestMenuItems(presentThreadPr({ ...pullRequest, state }, null)),
      ).toEqual([
        {
          id: "open-pull-request",
          title: "Open pull request #42",
          image: "arrow.up.right",
        },
      ]);
    },
  );

  it("uses merge request terminology for GitLab", () => {
    const mergeRequest = presentThreadPr(pullRequest, {
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.com",
    });

    expect(buildThreadPullRequestMenuItems(mergeRequest)).toEqual([
      {
        id: "open-pull-request",
        title: "Open merge request #42",
        image: "arrow.up.right",
      },
    ]);
  });
});

describe("openThreadPullRequest", () => {
  it("opens the URL from the linked pull request", async () => {
    openExternalUrl.mockResolvedValue(true);

    await openThreadPullRequest(presentThreadPr(pullRequest, null));

    expect(openExternalUrl).toHaveBeenCalledWith(pullRequest.url, "pull-request");
    expect(showAlert).not.toHaveBeenCalled();
  });

  it("reports a browser failure", async () => {
    openExternalUrl.mockResolvedValue(false);

    await openThreadPullRequest(presentThreadPr(pullRequest, null));

    expect(showAlert).toHaveBeenCalledWith(
      "Unable to open pull request",
      "The pull request could not be opened.",
    );
  });
});
