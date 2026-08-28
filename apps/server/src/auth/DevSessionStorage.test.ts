// @effect-diagnostics nodeBuiltinImport:off - verifies SQLite file permissions at the OS boundary.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeRuntimeSqliteLayer } from "../persistence/Layers/Sqlite.ts";
import { makeDevSessionStorage } from "./DevSessionStorage.ts";

it.layer(NodeServices.layer)("DevSessionStorage", (it) => {
  it.effect("initializes concurrent stores with one key and one session database", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const platform = yield* HostProcessPlatform;
      const devAuthDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-dev-session-storage-test-",
      });

      const [first, second] = yield* Effect.all(
        [makeDevSessionStorage(devAuthDir), makeDevSessionStorage(devAuthDir)],
        { concurrency: "unbounded" },
      );

      expect(first.signingSecret).toHaveLength(32);
      expect(second.signingSecret).toEqual(first.signingSecret);

      const sessionId = AuthSessionId.make("shared-session");
      const issuedAt = yield* DateTime.now;
      const expiresAt = DateTime.add(issuedAt, { days: 30 });
      yield* first.authSessions.create({
        sessionId,
        subject: "one-time-token",
        scopes: ["orchestration:read"],
        method: "browser-session-cookie",
        client: {
          label: null,
          ipAddress: null,
          userAgent: null,
          deviceType: "desktop",
          os: null,
          browser: null,
        },
        issuedAt,
        expiresAt,
      });
      expect(Option.getOrThrow(yield* second.authSessions.getById({ sessionId })).sessionId).toBe(
        sessionId,
      );

      const dbPath = path.join(devAuthDir, "sessions-v1.sqlite");
      const inspectionContext = yield* Layer.build(makeRuntimeSqliteLayer({ filename: dbPath }));
      const tables = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ readonly name: string }>`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
          ORDER BY name
        `;
      }).pipe(Effect.provide(inspectionContext));

      expect(tables.map((table) => table.name)).toEqual(["auth_sessions", "dev_auth_metadata"]);
      if (platform !== "win32") {
        expect(NodeFS.statSync(devAuthDir).mode & 0o777).toBe(0o700);
        expect(NodeFS.statSync(dbPath).mode & 0o777).toBe(0o600);
      }
    }),
  );

  it.effect("rejects an empty stored signing key", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const devAuthDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-dev-session-key-test-",
      });
      yield* makeDevSessionStorage(devAuthDir);

      const dbPath = path.join(devAuthDir, "sessions-v1.sqlite");
      const inspectionContext = yield* Layer.build(makeRuntimeSqliteLayer({ filename: dbPath }));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE dev_auth_metadata SET value = ''`;
      }).pipe(Effect.provide(inspectionContext));

      const error = yield* makeDevSessionStorage(devAuthDir).pipe(Effect.flip);
      expect(error._tag).toBe("SchemaError");
    }),
  );

  it.effect("retains the signing key and sessions after every store scope closes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const devAuthDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-dev-session-restart-test-",
      });
      const sessionId = AuthSessionId.make("session-after-restart");

      const firstKey = yield* Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* makeDevSessionStorage(devAuthDir);
          const issuedAt = yield* DateTime.now;
          yield* storage.authSessions.create({
            sessionId,
            subject: "one-time-token",
            scopes: ["orchestration:read"],
            method: "browser-session-cookie",
            client: {
              label: null,
              ipAddress: null,
              userAgent: null,
              deviceType: "desktop",
              os: null,
              browser: null,
            },
            issuedAt,
            expiresAt: DateTime.add(issuedAt, { days: 30 }),
          });
          return storage.signingSecret;
        }),
      );

      const reopened = yield* Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* makeDevSessionStorage(devAuthDir);
          return {
            signingSecret: storage.signingSecret,
            session: yield* storage.authSessions.getById({ sessionId }),
          };
        }),
      );

      expect(reopened.signingSecret).toEqual(firstKey);
      expect(Option.getOrThrow(reopened.session).sessionId).toBe(sessionId);
    }),
  );
});
