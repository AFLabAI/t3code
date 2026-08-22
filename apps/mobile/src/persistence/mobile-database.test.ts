import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

const openDatabaseAsync = vi.hoisted(() => vi.fn());

vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));

import { decodeLegacyCacheRecord, make } from "./mobile-database";

describe("mobile database legacy cache migration", () => {
  it.effect("keeps acquisition failures typed on database operations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        openDatabaseAsync.mockRejectedValueOnce(new Error("SQLite unavailable"));

        const database = yield* make;
        const result = yield* Effect.result(database.loadPreferencesJson);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "MobileDatabaseError", operation: "open" },
        });
      }),
    ),
  );

  it.effect("does not turn database close failures into scope defects", () =>
    Effect.gen(function* () {
      const closeAsync = vi.fn().mockRejectedValue(new Error("SQLite close failed"));
      openDatabaseAsync.mockResolvedValueOnce({
        closeAsync,
        execAsync: vi.fn().mockResolvedValue(undefined),
        getFirstAsync: vi.fn().mockResolvedValue({ user_version: 1 }),
        withExclusiveTransactionAsync: vi.fn(
          (run: (transaction: { execAsync: () => Promise<void> }) => Promise<void>) =>
            run({ execAsync: () => Promise.resolve() }),
        ),
      });

      const result = yield* Effect.exit(Effect.scoped(make.pipe(Effect.asVoid)));

      expect(result._tag).toBe("Success");
      expect(closeAsync).toHaveBeenCalledTimes(1);
    }),
  );

  it("maps legacy thread records to their SQLite identity", () => {
    const payload = JSON.stringify({
      schemaVersion: 2,
      environmentId: "environment-1",
      threadId: "thread-1",
      snapshot: {},
    });

    expect(decodeLegacyCacheRecord("connection-thread-snapshots", payload)).toEqual({
      environmentId: "environment-1",
      kind: "thread",
      cacheKey: "thread-1",
      schemaVersion: 2,
      payload,
    });
  });

  it("preserves the old shell payload for schema decoding after migration", () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      environmentId: "environment-1",
      snapshotReceivedAt: "2026-07-01T00:00:00.000Z",
      snapshot: {},
    });

    expect(decodeLegacyCacheRecord("shell-snapshots", payload)).toEqual({
      environmentId: "environment-1",
      kind: "shell",
      cacheKey: "snapshot",
      schemaVersion: 1,
      payload,
    });
  });

  it("skips malformed legacy records", () => {
    expect(decodeLegacyCacheRecord("connection-vcs-refs", "{not-json")).toBeNull();
    expect(
      decodeLegacyCacheRecord(
        "connection-vcs-refs",
        JSON.stringify({ schemaVersion: 1, environmentId: "environment-1" }),
      ),
    ).toBeNull();
  });
});
