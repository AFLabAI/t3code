import { describe, expect, it } from "@effect/vitest";

import { summarizeToolGroup } from "./presentation.ts";

describe("summarizeToolGroup", () => {
  it("deduplicates named sources ahead of ordinary actions", () => {
    const source = { key: "browser-use:chrome", name: "Chrome", kind: "integration" as const };
    expect(
      summarizeToolGroup([
        { label: "Open page", tone: "tool", toolSource: source },
        { label: "Inspect page", tone: "tool", toolSource: source },
        {
          label: "Ran command",
          tone: "tool",
          itemType: "command_execution",
          command: "git status",
        },
      ]),
    ).toBe("Used Chrome integration and ran 1 command");
  });

  it("omits the integration suffix for special browser and computer sources", () => {
    expect(
      summarizeToolGroup([
        {
          label: "Inspect page",
          tone: "tool",
          toolSource: { key: "browser-use", name: "Browser", kind: "browser" },
        },
        {
          label: "Click",
          tone: "tool",
          toolSource: { key: "computer-use", name: "Computer Use", kind: "computer" },
        },
      ]),
    ).toBe("Used Browser and Computer Use");
  });
});
