import { describe, expect, it } from "vite-plus/test";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { RelayApi, RelayAuthInvalidError } from "./relay.ts";

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});

describe("RelayAuthInvalidError", () => {
  it("gives clock-skew failures an actionable message", () => {
    const error = new RelayAuthInvalidError({
      code: "auth_invalid",
      reason: "invalid_dpop",
      traceId: "trace-1",
      clockSkewSeconds: 25,
    });

    expect(error.message).toContain("device's clock");
    expect(error.message).toContain("automatic date and time");
  });
});
