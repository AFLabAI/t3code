import { EnvironmentAuthInvalidError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mapRemoteEnvironmentError } from "./errors.ts";

describe("mapRemoteEnvironmentError", () => {
  it("turns a DPoP clock-skew rejection into actionable connection guidance", () => {
    const mapped = mapRemoteEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-clock-skew",
        clockSkewSeconds: 25,
      }),
    );

    expect(mapped).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "authentication",
      detail:
        "The clocks on this device and the environment host are out of sync. Enable automatic date and time on both, then try again.",
      traceId: "trace-clock-skew",
    });
  });

  it("keeps generic credential guidance when the server did not identify clock skew", () => {
    const mapped = mapRemoteEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-invalid-credential",
      }),
    );

    expect(mapped.detail).toBe("The environment credential is invalid.");
  });
});
