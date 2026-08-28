import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopEnvironmentBootstrapSchema,
  DesktopPreviewAutomationClickInputSchema,
  DesktopPreviewAutomationClickResultSchema,
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

describe("DesktopPreviewAutomationClickInputSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopPreviewAutomationClickInputSchema);
  const input = {
    tabId: "tab-1",
    webContentsId: 42,
    attachmentId: "preview-attachment-1",
    input: { x: 10, y: 20 },
  };

  it("requires the exact webview attachment identity", () => {
    expect(decode(input)).toEqual(input);
    expect(() => decode({ ...input, webContentsId: undefined })).toThrow();
    expect(() => decode({ ...input, attachmentId: undefined })).toThrow();
  });
});

describe("DesktopPreviewAutomationClickResultSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopPreviewAutomationClickResultSchema);

  it("keeps the native pre-dispatch timeout budget", () => {
    expect(decode({ _tag: "NotSent", reason: "timeout", timeoutMs: 45 })).toEqual({
      _tag: "NotSent",
      reason: "timeout",
      timeoutMs: 45,
    });
    expect(() => decode({ _tag: "NotSent", reason: "timeout" })).toThrow();
  });
});
