import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as AuthSessions from "../persistence/AuthSessions.ts";
import { makeRuntimeSqliteLayer } from "../persistence/Layers/Sqlite.ts";

const DATABASE_NAME = "sessions-v1.sqlite";
const SIGNING_SECRET_NAME = "session-signing-key-v1";
const SigningSecretText = Schema.String.check(
  Schema.isLengthBetween(43, 43),
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/),
);
const SigningSecretRows = Schema.Tuple([Schema.Struct({ value: SigningSecretText })]);
const decodeSigningSecretRows = Schema.decodeUnknownEffect(SigningSecretRows);

const setupSchema = Effect.fn("DevSessionStorage.setupSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`PRAGMA busy_timeout = 5000;`;
  yield* sql`PRAGMA journal_mode = WAL;`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      scopes TEXT NOT NULL,
      method TEXT NOT NULL,
      client_label TEXT,
      client_ip_address TEXT,
      client_user_agent TEXT,
      client_device_type TEXT NOT NULL DEFAULT 'unknown',
      client_os TEXT,
      client_browser TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_connected_at TEXT,
      revoked_at TEXT,
      client_surface TEXT,
      client_app_version TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON auth_sessions(revoked_at, expires_at, issued_at)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS dev_auth_metadata (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
});

export const makeDevSessionStorage = Effect.fn("makeDevSessionStorage")(function* (
  devAuthDir: string,
) {
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dbPath = path.join(devAuthDir, DATABASE_NAME);

  yield* fs.makeDirectory(devAuthDir, { recursive: true });
  yield* fs.chmod(devAuthDir, 0o700);
  yield* Effect.scoped(fs.open(dbPath, { flag: "a", mode: 0o600 }).pipe(Effect.asVoid));
  yield* fs.chmod(dbPath, 0o600);

  const sqlLayer = makeRuntimeSqliteLayer({
    filename: dbPath,
    spanAttributes: {
      "db.name": DATABASE_NAME,
      "service.name": "t3-dev-auth",
    },
  });
  const sqlContext = yield* Layer.build(sqlLayer);
  const storage = yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* setupSchema();

    const candidate = Encoding.encodeBase64Url(yield* crypto.randomBytes(32));
    yield* sql`
      INSERT INTO dev_auth_metadata (name, value)
      VALUES (${SIGNING_SECRET_NAME}, ${candidate})
      ON CONFLICT(name) DO NOTHING
    `;
    const rows = yield* sql<{ readonly value: unknown }>`
      SELECT value AS "value"
      FROM dev_auth_metadata
      WHERE name = ${SIGNING_SECRET_NAME}
    `;
    const decodedRows = yield* decodeSigningSecretRows(rows);
    const signingSecret = Uint8Array.from(Buffer.from(decodedRows[0].value, "base64url"));
    const authSessions = yield* AuthSessions.make;

    return { authSessions, signingSecret };
  }).pipe(Effect.provide(sqlContext));

  return storage;
});
