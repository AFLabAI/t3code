// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory, makeSqlitePersistenceLive } from "./Sqlite.ts";

const lockHolderSource = `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec(process.argv[3] === "exclusive" ? "BEGIN EXCLUSIVE" : "BEGIN IMMEDIATE");
process.stdout.write("locked\\n");
setTimeout(() => {
  db.exec("COMMIT");
  db.close();
}, Number(process.argv[2]));
`;

const spawnWriteLockHolder = (
  dbPath: string,
  holdMs: number,
  mode: "immediate" | "exclusive" = "immediate",
) =>
  Effect.promise(
    () =>
      new Promise<NodeChildProcess.ChildProcess>((resolve, reject) => {
        const holder = NodeChildProcess.spawn(
          process.execPath,
          ["-e", lockHolderSource, dbPath, String(holdMs), mode],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        holder.stdout?.once("data", () => resolve(holder));
        holder.on("error", reject);
        holder.on("exit", () =>
          reject(new Error("lock holder exited before acquiring the write lock")),
        );
      }),
  );

const withBlockedStatementPreparation = <A, E, R>(
  statementFragment: string,
  isBlocked: () => boolean,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const originalPrepare = NodeSqlite.DatabaseSync.prototype.prepare;
      NodeSqlite.DatabaseSync.prototype.prepare = function (statement: string) {
        if (statement.includes(statementFragment) && isBlocked()) {
          throw Object.assign(new Error("database is locked"), {
            code: "ERR_SQLITE_ERROR",
            errcode: 5,
            errstr: "database is locked",
          });
        }
        return originalPrepare.call(this, statement);
      };
      return originalPrepare;
    }),
    () => effect,
    (originalPrepare) =>
      Effect.sync(() => {
        NodeSqlite.DatabaseSync.prototype.prepare = originalPrepare;
      }),
  );

it.live("waits out a concurrent writer instead of failing with SQLITE_BUSY", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-busy-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE busy_probe(id INTEGER PRIMARY KEY)`;
    yield* spawnWriteLockHolder(dbPath, 300);
    yield* sql`INSERT INTO busy_probe(id) VALUES (${1})`;
    const rows = yield* sql<{ readonly id: number }>`SELECT id FROM busy_probe`;
    assert.deepEqual([...rows], [{ id: 1 }]);
  }).pipe(
    Effect.provide(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.live("retries statement preparation after an exclusive database lock clears", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-prepare-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE prepare_probe(id INTEGER PRIMARY KEY)`;
    yield* sql`INSERT INTO prepare_probe(id) VALUES (${1})`;
    yield* sql`PRAGMA journal_mode = DELETE`;
    const holder = yield* spawnWriteLockHolder(dbPath, 150, "exclusive");
    let preparationBlocked = true;
    holder.once("exit", () => {
      preparationBlocked = false;
    });

    yield* withBlockedStatementPreparation(
      "SELECT id FROM prepare_probe",
      () => preparationBlocked,
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly id: number }>`SELECT id FROM prepare_probe`;
        assert.deepEqual([...rows], [{ id: 1 }]);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => holder.kill())));
  }).pipe(
    Effect.provide(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.live("keeps the Node event loop responsive while waiting for a write lock", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-yield-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE yield_probe(id INTEGER PRIMARY KEY)`;
    const holder = yield* spawnWriteLockHolder(dbPath, 300);

    yield* Effect.gen(function* () {
      const startedAt = performance.now();
      const [, timerDelayMs] = yield* Effect.all(
        [
          sql`INSERT INTO yield_probe(id) VALUES (${1})`,
          Effect.sleep("20 millis").pipe(Effect.map(() => performance.now() - startedAt)),
        ],
        { concurrency: "unbounded" },
      );

      assert.isBelow(timerDelayMs, 200);
    }).pipe(Effect.ensuring(Effect.sync(() => holder.kill())));
  }).pipe(
    Effect.provide(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.live("interrupts a write that is waiting for another process to release its lock", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-interrupt-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE interrupt_probe(id INTEGER PRIMARY KEY)`;
    const holder = yield* spawnWriteLockHolder(dbPath, 1_000);

    yield* Effect.gen(function* () {
      const startedAt = performance.now();
      const waitingWrite = yield* Effect.forkChild(
        sql`INSERT INTO interrupt_probe(id) VALUES (${1})`,
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(waitingWrite);

      assert.isBelow(performance.now() - startedAt, 300);
    }).pipe(Effect.ensuring(Effect.sync(() => holder.kill())));
  }).pipe(
    Effect.provide(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("returns a typed lock timeout after five seconds of contention", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-timeout-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE timeout_probe(id INTEGER PRIMARY KEY)`;
    const holder = yield* spawnWriteLockHolder(dbPath, 10_000);

    yield* Effect.gen(function* () {
      const waitingWrite = yield* Effect.forkChild(
        Effect.result(sql`INSERT INTO timeout_probe(id) VALUES (${1})`),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("6 seconds");
      const result = yield* Fiber.join(waitingWrite);

      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.equal(result.failure._tag, "SqlError");
        assert.equal(result.failure.reason._tag, "LockTimeoutError");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => holder.kill())));
  }).pipe(
    Effect.provide(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("does not cache a statement preparation failure after its lock timeout", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-prepare-timeout-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE prepare_timeout_probe(id INTEGER PRIMARY KEY)`;
    yield* sql`INSERT INTO prepare_timeout_probe(id) VALUES (${1})`;
    yield* sql`PRAGMA journal_mode = DELETE`;
    const holder = yield* spawnWriteLockHolder(dbPath, 10_000, "exclusive");
    let preparationBlocked = true;

    yield* withBlockedStatementPreparation(
      "SELECT id FROM prepare_timeout_probe",
      () => preparationBlocked,
      Effect.gen(function* () {
        const readRows = sql<{ readonly id: number }>`SELECT id FROM prepare_timeout_probe`;
        const waitingRead = yield* Effect.forkChild(Effect.result(readRows));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("6 seconds");
        const result = yield* Fiber.join(waitingRead);

        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.equal(result.failure.reason._tag, "LockTimeoutError");
          assert.equal(result.failure.reason.operation, "prepare");
        }

        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              holder.once("exit", () => {
                preparationBlocked = false;
                resolve();
              });
              holder.kill();
            }),
        );

        const rows = yield* readRows;
        assert.deepEqual([...rows], [{ id: 1 }]);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => holder.kill())));
  }).pipe(
    Effect.provide(makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("configures lock waiting for the active SQLite runtime", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout`;
    assert.equal(rows[0]?.timeout, process.versions.bun === undefined ? 0 : 5000);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
