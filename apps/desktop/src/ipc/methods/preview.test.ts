import { it as effectIt } from "@effect/vitest";
import { PreviewAutomationStatus } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as PreviewManager from "../../preview/Manager.ts";
import * as PreviewIpc from "./preview.ts";

const { fromPartition } = vi.hoisted(() => ({
  fromPartition: vi.fn(() => {
    throw new Error("Session can only be received when app is ready");
  }),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  session: {
    fromPartition,
  },
  webContents: {
    fromId: vi.fn(() => null),
  },
}));

const snapshotInput = {
  tabId: "runtime-tab",
  connectionId: "connection-1",
  requestId: "request-1",
  timeoutMs: 15_000,
} as const;

describe("preview IPC methods", () => {
  beforeEach(() => {
    fromPartition.mockClear();
  });

  it("does not access the Electron session while the module loads", async () => {
    await expect(import("./preview.ts")).resolves.toBeDefined();
    expect(fromPartition).not.toHaveBeenCalled();
  });

  effectIt.effect("rejects invalid webContents ids before resolving the preview service", () =>
    Effect.map(
      PreviewIpc.registerWebview
        .handler({ tabId: "tab-1", webContentsId: 0 })
        .pipe(Effect.provideService(PreviewManager.PreviewManager, null as never), Effect.exit),
      (exit) => {
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        const error = Cause.findErrorOption(exit.cause);
        expect(Option.isSome(error) && Schema.isSchemaError(error.value)).toBe(true);
        expect(fromPartition).not.toHaveBeenCalled();
      },
    ),
  );

  effectIt.effect("returns automation status for long runtime tab ids", () =>
    Effect.gen(function* () {
      const tabId =
        `["environment-1","thread:delegated-task:${"a".repeat(120)}",` +
        `"server-epoch-1","preview-1"]`;
      const status = {
        available: false,
        visible: true,
        tabId,
        url: null,
        title: null,
        loading: false,
      };
      const manager = PreviewManager.PreviewManager.of({
        automationStatus: () => Effect.succeed(status),
      } as unknown as PreviewManager.PreviewManager["Service"]);

      expect(tabId.length).toBeGreaterThan(128);
      expect(
        yield* PreviewIpc.automationStatus
          .handler({ tabId })
          .pipe(Effect.provideService(PreviewManager.PreviewManager, manager)),
      ).toEqual(status);
    }),
  );

  it("keeps the public automation status tab id limit", () => {
    const encode = Schema.encodeUnknownSync(PreviewAutomationStatus);
    const tabId = "t".repeat(129);

    expect(() =>
      encode({
        available: false,
        visible: true,
        tabId,
        url: null,
        title: null,
        loading: false,
      }),
    ).toThrow();
  });

  effectIt.effect("encodes Manager deadline errors as timeout results", () =>
    Effect.gen(function* () {
      const error = new PreviewManager.PreviewAutomationDeadlineExceededError({
        operation: "snapshot",
        tabId: snapshotInput.tabId,
        webContentsId: 42,
        connectionId: snapshotInput.connectionId,
        requestId: snapshotInput.requestId,
        timeoutMs: snapshotInput.timeoutMs,
        stage: "execution",
      });
      const automationSnapshot = vi.fn(() => Effect.fail(error));

      const result = yield* PreviewIpc.automationSnapshot
        .handler(snapshotInput)
        .pipe(
          Effect.provideService(
            PreviewManager.PreviewManager,
            PreviewManager.PreviewManager.of({ automationSnapshot } as never),
          ),
        );

      expect(automationSnapshot).toHaveBeenCalledWith(snapshotInput);
      expect(result).toEqual({
        _tag: "Timeout",
        stage: "execution",
        timeoutMs: snapshotInput.timeoutMs,
      });
    }),
  );

  effectIt.effect("keeps unexpected Manager failures rejected", () =>
    Effect.gen(function* () {
      const error = new PreviewManager.PreviewOperationError({
        operation: "automationSnapshot.capturePage",
        tabId: snapshotInput.tabId,
        webContentsId: 42,
        cause: new Error("capture failed"),
      });
      const automationSnapshot = vi.fn(() => Effect.fail(error));

      const exit = yield* PreviewIpc.automationSnapshot
        .handler(snapshotInput)
        .pipe(
          Effect.provideService(
            PreviewManager.PreviewManager,
            PreviewManager.PreviewManager.of({ automationSnapshot } as never),
          ),
          Effect.exit,
        );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe(error);
    }),
  );
});
