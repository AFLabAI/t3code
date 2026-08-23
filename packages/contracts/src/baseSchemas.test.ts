import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { IsoDateTime, ValidIsoDateTime } from "./baseSchemas.ts";

const decodeIsoDateTime = Schema.decodeUnknownSync(IsoDateTime);
const decodeValidIsoDateTime = Schema.decodeUnknownSync(ValidIsoDateTime);

describe("IsoDateTime", () => {
  it("keeps historical and remote timestamps backward compatible", () => {
    expect(decodeIsoDateTime("invalid legacy timestamp")).toBe("invalid legacy timestamp");
  });
});

describe("ValidIsoDateTime", () => {
  it.each([
    "2026-08-22T14:00:00.000Z",
    "2026-08-22T14:00:00Z",
    "2026-08-22T14:00:00+02:00",
    "2026-08-22T14:00:00-07:00",
    "2024-02-29T12:00:00Z",
  ])("accepts the timestamp %s", (value) => {
    expect(decodeValidIsoDateTime(value)).toBe(value);
  });

  it.each([
    "",
    "not a date",
    "today",
    "2026-08-22",
    "2026-13-22T14:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T24:00:00Z",
  ])("rejects the invalid timestamp %s", (value) => {
    expect(() => decodeValidIsoDateTime(value)).toThrow();
  });
});
