import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopEnvironmentBootstrapSchema,
  DesktopPreviewAutomationSnapshotInputSchema,
} from "./ipc.ts";

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});

describe("DesktopPreviewAutomationSnapshotInputSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopPreviewAutomationSnapshotInputSchema);

  it("requires a positive timeout", () => {
    expect(() =>
      decode({
        tabId: "runtime-tab",
        connectionId: "connection-1",
        requestId: "request-1",
      }),
    ).toThrow();
    expect(() =>
      decode({
        tabId: "runtime-tab",
        connectionId: "connection-1",
        requestId: "request-1",
        timeoutMs: 0,
      }),
    ).toThrow();
  });

  it("preserves long runtime and request ids at the connection id limit", () => {
    const input = {
      tabId: `runtime-${"t".repeat(512)}`,
      connectionId: "c".repeat(64),
      requestId: `request-${"r".repeat(512)}`,
      timeoutMs: 14_750,
    };

    expect(decode(input)).toEqual(input);
  });
});
