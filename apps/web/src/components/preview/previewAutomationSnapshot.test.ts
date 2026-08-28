import type {
  DesktopPreviewAutomationSnapshotInput,
  DesktopPreviewAutomationSnapshotResult,
  PreviewAutomationSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { requestPreviewAutomationSnapshot, responseBudgetMs } from "./previewAutomationSnapshot";

const snapshot = {
  url: "https://example.com",
  title: "Example",
  loading: false,
  visibleText: "Example",
  interactiveElements: [],
  accessibilityTree: {},
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: {
    mimeType: "image/png",
    data: "cG5n",
    width: 1,
    height: 1,
  },
} as const satisfies PreviewAutomationSnapshot;

const timeoutError = (tabId: string | null) => new Error(`timed out:${tabId ?? "unready"}`);

describe("preview snapshot host budget", () => {
  it("keeps a response margin for every positive duration", () => {
    expect(responseBudgetMs(15_000, 1_000)).toBe(14_000);
    expect(responseBudgetMs(10, 1_000)).toBe(9);
    expect(responseBudgetMs(1, 1_000)).toBe(0);
  });

  it("subtracts readiness time and forwards exact request identity", async () => {
    let now = 100;
    const desktopSnapshot = vi.fn(
      async (
        _input: DesktopPreviewAutomationSnapshotInput,
      ): Promise<DesktopPreviewAutomationSnapshotResult> => ({ _tag: "Success", snapshot }),
    );

    await expect(
      requestPreviewAutomationSnapshot({
        connectionId: "connection-from-stream-event",
        requestId: "request-with-a-long-runtime-tab-id",
        hostDeadline: 14_100,
        now: () => now,
        requireReady: async (timeoutMs) => {
          expect(timeoutMs).toBe(14_000);
          now += 2_000;
          return {
            tabId: "tab-public",
            runtimeTabId: `runtime-${"x".repeat(512)}`,
            snapshot: desktopSnapshot,
          };
        },
        onTimeout: timeoutError,
      }),
    ).resolves.toEqual(snapshot);

    expect(desktopSnapshot).toHaveBeenCalledWith({
      tabId: `runtime-${"x".repeat(512)}`,
      connectionId: "connection-from-stream-event",
      requestId: "request-with-a-long-runtime-tab-id",
      timeoutMs: 11_750,
    });
  });

  it("does not call desktop snapshot after readiness exhausts the budget", async () => {
    let now = 0;
    const desktopSnapshot = vi.fn(
      async (): Promise<DesktopPreviewAutomationSnapshotResult> => ({
        _tag: "Success",
        snapshot,
      }),
    );

    await expect(
      requestPreviewAutomationSnapshot({
        connectionId: "connection-1",
        requestId: "request-1",
        hostDeadline: 900,
        now: () => now,
        requireReady: async () => {
          now = 900;
          return {
            tabId: "tab-public",
            runtimeTabId: "runtime-tab",
            snapshot: desktopSnapshot,
          };
        },
        onTimeout: timeoutError,
      }),
    ).rejects.toThrow("timed out:tab-public");
    expect(desktopSnapshot).not.toHaveBeenCalled();
  });

  it("maps an encoded desktop timeout to the host timeout", async () => {
    const desktopSnapshot = vi.fn(
      async (): Promise<DesktopPreviewAutomationSnapshotResult> => ({
        _tag: "Timeout",
        stage: "execution",
        timeoutMs: 800,
      }),
    );

    await expect(
      requestPreviewAutomationSnapshot({
        connectionId: "connection-1",
        requestId: "request-1",
        hostDeadline: 900,
        now: () => 0,
        requireReady: async () => ({
          tabId: "tab-public",
          runtimeTabId: "runtime-tab",
          snapshot: desktopSnapshot,
        }),
        onTimeout: timeoutError,
      }),
    ).rejects.toThrow("timed out:tab-public");
  });

  it("bounds readiness that never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = requestPreviewAutomationSnapshot({
        connectionId: "connection-1",
        requestId: "request-1",
        hostDeadline: 900,
        now: () => 0,
        requireReady: () => new Promise(() => undefined),
        onTimeout: timeoutError,
      });
      const rejected = expect(pending).rejects.toThrow("timed out:unready");

      await vi.advanceTimersByTimeAsync(900);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a desktop success that arrives after the absolute deadline", async () => {
    let now = 0;

    await expect(
      requestPreviewAutomationSnapshot({
        connectionId: "connection-1",
        requestId: "request-1",
        hostDeadline: 900,
        now: () => now,
        requireReady: async () => ({
          tabId: "tab-public",
          runtimeTabId: "runtime-tab",
          snapshot: async () => {
            now = 900;
            return { _tag: "Success", snapshot };
          },
        }),
        onTimeout: timeoutError,
      }),
    ).rejects.toThrow("timed out:tab-public");
  });
});
