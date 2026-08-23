import * as Path from "effect/Path";
import * as AcpError from "./errors.ts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Ref from "effect/Ref";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { it, assert } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as AcpSchema from "./_generated/schema.gen.ts";
import * as AcpProtocol from "./protocol.ts";
import {
  encodeJsonl,
  jsonRpcNotification,
  jsonRpcRequest,
  jsonRpcResponse,
} from "./_internal/shared.ts";
import { makeInMemoryStdio, makeTerminationError, makeChildStdio } from "./_internal/stdio.ts";

const SessionCancelNotification = jsonRpcNotification(
  "session/cancel",
  AcpSchema.CancelNotification,
);
const SessionUpdateNotification = jsonRpcNotification(
  "session/update",
  AcpSchema.SessionNotification,
);
const ElicitationCompleteNotification = jsonRpcNotification(
  "session/elicitation/complete",
  AcpSchema.ElicitationCompleteNotification,
);
const RequestPermissionRequest = jsonRpcRequest(
  "session/request_permission",
  AcpSchema.RequestPermissionRequest,
);
const RequestPermissionResponse = jsonRpcResponse(AcpSchema.RequestPermissionResponse);
const ExtRequest = jsonRpcRequest("x/test", Schema.Struct({ hello: Schema.String }));
const ExtResponse = jsonRpcResponse(Schema.Struct({ ok: Schema.Boolean }));
const decodeSessionCancelNotification = Schema.decodeEffect(
  Schema.fromJsonString(SessionCancelNotification),
);
const decodeExtRequest = Schema.decodeEffect(Schema.fromJsonString(ExtRequest));
const decodeExtResponse = Schema.decodeEffect(Schema.fromJsonString(ExtResponse));
const decodeRequestPermissionResponse = Schema.decodeEffect(
  Schema.fromJsonString(RequestPermissionResponse),
);
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encoder = new TextEncoder();
const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/acp-mock-peer.ts"),
);
const mockPeerArgs = (path: string) => [path];

const makeHandle = (env?: Record<string, string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const path = yield* Path.Path;
    const command = ChildProcess.make(process.execPath, mockPeerArgs(yield* mockPeerPath), {
      cwd: path.join(import.meta.dirname, ".."),
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return yield* spawner.spawn(command);
  });

it.layer(NodeServices.layer)("effect-acp protocol", (it) => {
  it.effect(
    "emits exact JSON-RPC notifications and decodes inbound session/update and elicitation completion",
    () =>
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
          stdio,
          serverRequestMethods: new Set(),
        });

        const notifications =
          yield* Deferred.make<ReadonlyArray<AcpProtocol.AcpIncomingNotification>>();
        yield* transport.incoming.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.flatMap((notificationChunk) => Deferred.succeed(notifications, notificationChunk)),
          Effect.forkScoped,
        );

        yield* transport.notify("session/cancel", { sessionId: "session-1" });
        const outbound = yield* Queue.take(output);
        assert.deepEqual(yield* decodeSessionCancelNotification(outbound), {
          jsonrpc: "2.0",
          method: "session/cancel",
          params: {
            sessionId: "session-1",
          },
        });

        yield* Queue.offer(
          input,
          yield* encodeJsonl(SessionUpdateNotification, {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "plan",
                entries: [
                  {
                    content: "Inspect repository",
                    priority: "high",
                    status: "in_progress",
                  },
                ],
              },
            },
          }),
        );

        yield* Queue.offer(
          input,
          yield* encodeJsonl(ElicitationCompleteNotification, {
            jsonrpc: "2.0",
            method: "session/elicitation/complete",
            params: {
              elicitationId: "elicitation-1",
            },
          }),
        );

        const [update, completion] = yield* Deferred.await(notifications);
        assert.equal(update?._tag, "SessionUpdate");
        assert.equal(completion?._tag, "ElicitationComplete");
      }),
  );

  it.effect("keeps invalid core notification values only in the schema cause", () =>
    Effect.gen(function* () {
      const secret = "acp-core-notification-secret-sentinel";
      const { stdio, input } = yield* makeInMemoryStdio();
      const termination = yield* Deferred.make<AcpError.AcpError>();
      yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeUnknownJsonString({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: { secret },
              update: {
                sessionUpdate: "plan",
                entries: [],
              },
            },
          })}\n`,
        ),
      );

      const error = yield* Deferred.await(termination);
      assert.instanceOf(error, AcpError.AcpProtocolParseError);
      const parseError = error as AcpError.AcpProtocolParseError;
      const { cause, ...directDiagnostics } = parseError;
      assert.equal(parseError.operation, "decode-notification-payload");
      assert.equal(parseError.method, "session/update");
      assert.isAbove(parseError.issueCount ?? 0, 0);
      assert.include(parseError.issueKinds ?? [], "Pointer");
      assert.isAbove(parseError.maximumPathDepth ?? 0, 0);
      assert.isTrue(Schema.isSchemaError(cause));
      assert.notInclude(parseError.message, secret);
      assert.notInclude(encodeUnknownJsonString(directDiagnostics), secret);
    }),
  );

  it.effect("logs outgoing notifications when logOutgoing is enabled", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const events: Array<AcpProtocol.AcpProtocolLogEvent> = [];
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        logOutgoing: true,
        logger: (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
      });

      yield* transport.notify("session/cancel", { sessionId: "session-1" });

      assert.deepEqual(events, [
        {
          direction: "outgoing",
          stage: "decoded",
          payload: {
            _tag: "Request",
            id: "",
            tag: "session/cancel",
            payload: {
              sessionId: "session-1",
            },
            headers: [],
          },
        },
        {
          direction: "outgoing",
          stage: "raw",
          payload:
            '{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"session-1"},"id":"","headers":[]}\n',
        },
      ]);
    }),
  );

  it.effect("logs decode failures without copying the cause or wire payload", () =>
    Effect.gen(function* () {
      const secret = "acp-wire-secret-sentinel";
      const { stdio, input } = yield* makeInMemoryStdio();
      const events: Array<AcpProtocol.AcpProtocolLogEvent> = [];
      const termination = yield* Deferred.make<AcpError.AcpError>();
      yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        logIncoming: true,
        logger: (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* Queue.offer(input, encoder.encode(`{"secret":"${secret}"\n`));
      yield* Deferred.await(termination);

      const event = events.find(({ stage }) => stage === "decode_failed");
      assert.deepEqual(event, {
        direction: "incoming",
        stage: "decode_failed",
        payload: {
          operation: "decode-wire-message",
        },
      });
      assert.notInclude(encodeUnknownJsonString(event), secret);
    }),
  );

  it.effect("fails notification encoding through the declared ACP error channel", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
      });

      const bigintError = yield* transport.notify("x/test", 1n).pipe(Effect.flip);
      assert.instanceOf(bigintError, AcpError.AcpProtocolParseError);
      assert.equal(bigintError.operation, "encode-message");
      assert.equal(bigintError.method, "x/test");
      assert.instanceOf(bigintError.cause, TypeError);
      assert.equal(
        bigintError.message,
        "ACP protocol operation 'encode-message' failed for method 'x/test'.",
      );

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const circularError = yield* transport.notify("x/test", circular).pipe(Effect.flip);
      assert.instanceOf(circularError, AcpError.AcpProtocolParseError);
      assert.equal(circularError.operation, "encode-message");
      assert.equal(circularError.method, "x/test");
      assert.instanceOf(circularError.cause, TypeError);

      const requestError = yield* transport.request("x/request", 1n).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Expected request encoding to fail"),
        }),
      );
      assert.instanceOf(requestError, AcpError.AcpProtocolParseError);
      assert.deepInclude(requestError, {
        operation: "encode-message",
        method: "x/request",
        requestId: 1,
      });
    }),
  );

  it.effect("supports generic extension requests over the patched transport", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
      });

      const response = yield* transport
        .request("x/test", { hello: "world" })
        .pipe(Effect.forkScoped);
      const outbound = yield* Queue.take(output);
      assert.deepEqual(yield* decodeExtRequest(outbound), {
        jsonrpc: "2.0",
        id: 1,
        method: "x/test",
        params: {
          hello: "world",
        },
        headers: [],
      });

      yield* Queue.offer(
        input,
        yield* encodeJsonl(ExtResponse, {
          jsonrpc: "2.0",
          id: 1,
          result: {
            ok: true,
          },
        }),
      );

      const resolved = yield* Fiber.join(response);
      assert.deepEqual(resolved, { ok: true });
    }),
  );

  it.effect("correlates extension response errors with the originating request", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
      });

      const response = yield* transport
        .request("x/private", { hello: "world" })
        .pipe(Effect.forkScoped);
      yield* Queue.take(output);
      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeUnknownJsonString({
            jsonrpc: "2.0",
            id: 1,
            error: {
              _tag: "Cause",
              code: -32602,
              message: "Invalid params",
              data: [
                {
                  _tag: "Fail",
                  error: {
                    code: -32602,
                    message: "Invalid params",
                    data: { field: "hello" },
                  },
                },
              ],
            },
          })}\n`,
        ),
      );

      const error = yield* Fiber.join(response).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Expected extension request to fail"),
        }),
      );
      assert.instanceOf(error, AcpError.AcpRequestError);
      assert.deepInclude(error, {
        code: -32602,
        errorMessage: "Invalid params",
        method: "x/private",
        requestId: 1,
        operation: "receive-response",
      });
    }),
  );

  it.effect("preserves numeric ids for inbound extension requests", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        onExtRequest: () => Effect.succeed({ ok: true }),
      });

      yield* Queue.offer(
        input,
        yield* encodeJsonl(ExtRequest, {
          jsonrpc: "2.0",
          id: 7,
          method: "x/test",
          params: {
            hello: "world",
          },
          headers: [],
        }),
      );

      const outbound = yield* Queue.take(output);
      assert.deepEqual(yield* decodeExtResponse(outbound), {
        jsonrpc: "2.0",
        id: 7,
        result: {
          ok: true,
        },
      });
    }),
  );

  it.effect("preserves zero-valued ids for inbound core client requests", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(["session/request_permission"]),
      });
      const inboundRequest = yield* Deferred.make<unknown>();

      yield* transport.serverProtocol
        .run((_clientId, message) => Deferred.succeed(inboundRequest, message).pipe(Effect.asVoid))
        .pipe(Effect.forkScoped);

      yield* Queue.offer(
        input,
        yield* encodeJsonl(RequestPermissionRequest, {
          jsonrpc: "2.0",
          id: 0,
          method: "session/request_permission",
          params: {
            sessionId: "session-1",
            toolCall: {
              toolCallId: "tool-1",
              title: "Allow mock action",
            },
            options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
          },
          headers: [],
        }),
      );

      const message = yield* Deferred.await(inboundRequest);
      assert.deepEqual(message, {
        _tag: "Request",
        id: 0,
        tag: "session/request_permission",
        payload: {
          sessionId: "session-1",
          toolCall: {
            toolCallId: "tool-1",
            title: "Allow mock action",
          },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        },
        headers: [],
      });

      yield* transport.serverProtocol.send(0, {
        _tag: "Exit",
        requestId: 0,
        exit: {
          _tag: "Success",
          value: {
            outcome: {
              outcome: "selected",
              optionId: "allow",
            },
          },
        },
      });

      const outbound = yield* Queue.take(output);
      assert.deepEqual(yield* decodeRequestPermissionResponse(outbound), {
        jsonrpc: "2.0",
        id: 0,
        result: {
          outcome: {
            outcome: "selected",
            optionId: "allow",
          },
        },
      });
    }),
  );

  it.effect("cleans up interrupted extension requests before a late response arrives", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
      });
      const lateResponse = yield* Deferred.make<unknown>();

      yield* transport.clientProtocol
        .run(0, (message) => Deferred.succeed(lateResponse, message).pipe(Effect.asVoid))
        .pipe(Effect.forkScoped);

      const response = yield* transport
        .request("x/test", { hello: "world" })
        .pipe(Effect.forkScoped);
      const outbound = yield* Queue.take(output);
      assert.deepEqual(yield* decodeExtRequest(outbound), {
        jsonrpc: "2.0",
        id: 1,
        method: "x/test",
        params: {
          hello: "world",
        },
        headers: [],
      });

      yield* Fiber.interrupt(response);
      yield* Queue.offer(
        input,
        yield* encodeJsonl(ExtResponse, {
          jsonrpc: "2.0",
          id: 1,
          result: {
            ok: true,
          },
        }),
      );

      const message = yield* Deferred.await(lateResponse);
      assert.deepEqual(message, {
        _tag: "Exit",
        requestId: 1,
        exit: {
          _tag: "Success",
          value: {
            ok: true,
          },
        },
      });
    }),
  );

  it.effect("propagates the real child exit code when the input stream ends", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle({ ACP_MOCK_EXIT_IMMEDIATELY_CODE: "7" });
      const firstMessage = yield* Deferred.make<unknown>();
      const termination = yield* Deferred.make<AcpError.AcpError>();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio: makeChildStdio(handle),
        terminationError: makeTerminationError(handle),
        serverRequestMethods: new Set(),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* transport.clientProtocol
        .run(0, (message) => Deferred.succeed(firstMessage, message).pipe(Effect.asVoid))
        .pipe(Effect.forkScoped);

      const message = yield* Deferred.await(firstMessage);
      const exitError = yield* Deferred.await(termination);
      assert.instanceOf(exitError, AcpError.AcpProcessExitedError);
      assert.equal((exitError as AcpError.AcpProcessExitedError).code, 7);
      assert.equal((message as { readonly _tag?: string })._tag, "ClientProtocolError");
      const defect = (message as { readonly error: { readonly reason: unknown } }).error.reason as {
        readonly _tag: string;
        readonly message: string;
        readonly cause: unknown;
      };
      assert.equal(defect._tag, "RpcClientDefect");
      assert.equal(defect.message, "ACP protocol terminated.");
      assert.instanceOf(defect.cause, AcpError.AcpProcessExitedError);
      assert.equal((defect.cause as AcpError.AcpProcessExitedError).code, 7);
    }),
  );

  it.effect("classifies an input stream ending without inventing a cause", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const termination = yield* Deferred.make<AcpError.AcpError>();
      yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* Queue.end(input);

      const error = yield* Deferred.await(termination);
      assert.instanceOf(error, AcpError.AcpInputStreamEndedError);
      assert.equal(error.message, "ACP input stream ended.");
      assert.equal("cause" in error, false);
    }),
  );

  it.effect("rejects new requests and notifications after the input stream ends", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const termination = yield* Deferred.make<AcpError.AcpError>();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* Queue.end(input);
      const error = yield* Deferred.await(termination);

      const requestError = yield* transport.request("x/late", {}).pipe(
        Effect.match({
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected a terminated request to fail"),
        }),
      );
      assert.strictEqual(requestError, error);
      assert.strictEqual(yield* transport.notify("x/late", {}).pipe(Effect.flip), error);
    }),
  );

  it.effect("fails a notification if the output queue closes while it is being encoded", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const encoded = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const termination = yield* Deferred.make<AcpError.AcpError>();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        logOutgoing: true,
        logger: (event) =>
          event.stage === "raw"
            ? Deferred.succeed(encoded, undefined).pipe(Effect.andThen(Deferred.await(resume)))
            : Effect.void,
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      const notification = yield* transport.notify("x/racing", {}).pipe(Effect.forkScoped);
      yield* Deferred.await(encoded);
      yield* Queue.end(input);
      const error = yield* Deferred.await(termination);
      yield* Deferred.succeed(resume, undefined);

      assert.strictEqual(yield* Fiber.join(notification).pipe(Effect.flip), error);
    }),
  );

  it.effect("drains buffered raw notifications and completes when the input stream ends", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const handled = yield* Deferred.make<void>();
      const observed = yield* Ref.make<Array<unknown>>([]);
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        onNotification: () => Deferred.succeed(handled, undefined).pipe(Effect.asVoid),
      });

      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeUnknownJsonString({ jsonrpc: "2.0", method: "x/buffered", params: 7 })}\n`,
        ),
      );
      yield* Deferred.await(handled);

      const drain = yield* transport.incoming.pipe(
        Stream.tap((notification) =>
          Ref.update(observed, (current) => [...current, notification.params]),
        ),
        Stream.runDrain,
        Effect.forkScoped,
      );
      yield* Queue.end(input);
      yield* Fiber.join(drain);

      assert.deepEqual(yield* Ref.get(observed), [7]);
    }),
  );

  it.effect("fails pending and future requests when the output writer fails", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const cause = PlatformError.systemError({
        _tag: "Unknown",
        module: "Stdio",
        method: "write",
        cause: new Error("broken output pipe"),
      });
      const termination = yield* Deferred.make<AcpError.AcpError>();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio: Stdio.make({
          args: stdio.args,
          stdin: stdio.stdin,
          stdout: () => Sink.forEach((_chunk: string | Uint8Array) => Effect.fail(cause)),
          stderr: stdio.stderr,
        }),
        serverRequestMethods: new Set(),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      const pending = yield* transport.request("x/pending", {}).pipe(Effect.forkScoped);
      const error = yield* Deferred.await(termination);

      assert.instanceOf(error, AcpError.AcpTransportError);
      assert.equal(error.operation, "write-output-stream");
      assert.strictEqual(error.cause, cause);
      const pendingError = yield* Fiber.join(pending).pipe(
        Effect.match({
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected the pending request to fail"),
        }),
      );
      const futureError = yield* transport.request("x/future", {}).pipe(
        Effect.match({
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected the future request to fail"),
        }),
      );
      assert.strictEqual(pendingError, error);
      assert.strictEqual(futureError, error);
    }),
  );

  it.effect("does not deliver notifications after the output writer terminates the protocol", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const cause = PlatformError.systemError({
        _tag: "Unknown",
        module: "Stdio",
        method: "write",
        cause: new Error("broken output pipe"),
      });
      const termination = yield* Deferred.make<AcpError.AcpError>();
      const lateMessageRead = yield* Deferred.make<void>();
      const notificationCount = yield* Ref.make(0);
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio: Stdio.make({
          args: stdio.args,
          stdin: stdio.stdin,
          stdout: () => Sink.forEach((_chunk: string | Uint8Array) => Effect.fail(cause)),
          stderr: stdio.stderr,
        }),
        serverRequestMethods: new Set(),
        logIncoming: true,
        logger: (event) =>
          event.stage === "decoded" &&
          Array.isArray(event.payload) &&
          event.payload.some((message) => message.tag === "x/barrier")
            ? Deferred.succeed(lateMessageRead, undefined).pipe(Effect.asVoid)
            : Effect.void,
        onNotification: () => Ref.update(notificationCount, (count) => count + 1),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* transport.notify("x/trigger", {});
      yield* Deferred.await(termination);
      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeUnknownJsonString({ jsonrpc: "2.0", method: "x/late", params: 1 })}\n`,
        ),
      );
      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeUnknownJsonString({ jsonrpc: "2.0", method: "x/barrier", params: 2 })}\n`,
        ),
      );
      yield* Deferred.await(lateMessageRead);

      assert.equal(yield* Ref.get(notificationCount), 0);
    }),
  );

  it.effect("keeps only the latest handled notifications for the raw stream", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const handled = yield* Deferred.make<void>();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        onNotification: (notification) =>
          notification._tag === "ExtNotification" && notification.params === 95
            ? Deferred.succeed(handled, undefined).pipe(Effect.asVoid)
            : Effect.void,
      });

      yield* Effect.forEach(
        Array.from({ length: 96 }, (_, index) => index),
        (index) =>
          Queue.offer(
            input,
            encoder.encode(
              `${encodeUnknownJsonString({ jsonrpc: "2.0", method: "x/event", params: index })}\n`,
            ),
          ),
        { discard: true },
      );
      yield* Deferred.await(handled);

      const buffered = yield* transport.incoming.pipe(Stream.take(64), Stream.runCollect);
      assert.equal(buffered.length, 64);
      assert.equal(buffered[0]?.params, 32);
      assert.equal(buffered[63]?.params, 95);
    }),
  );

  it.effect("does not emit a second process-exit error after a decode failure", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle({
        ACP_MOCK_MALFORMED_OUTPUT: "1",
        ACP_MOCK_MALFORMED_OUTPUT_EXIT_CODE: "23",
      });
      const terminationCalls = yield* Ref.make(0);
      const firstMessage = yield* Deferred.make<unknown>();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio: makeChildStdio(handle),
        terminationError: makeTerminationError(handle),
        serverRequestMethods: new Set(),
        onTermination: () => Ref.update(terminationCalls, (count) => count + 1),
      });

      yield* transport.clientProtocol
        .run(0, (message) => Deferred.succeed(firstMessage, message).pipe(Effect.asVoid))
        .pipe(Effect.forkScoped);

      const message = yield* Deferred.await(firstMessage);
      assert.equal(yield* Ref.get(terminationCalls), 1);
      assert.equal((message as { readonly _tag?: string })._tag, "ClientProtocolError");
      const defect = (message as { readonly error: { readonly reason: unknown } }).error.reason as {
        readonly _tag: string;
        readonly message: string;
        readonly cause: unknown;
      };
      assert.equal(defect._tag, "RpcClientDefect");
      assert.equal(defect.message, "ACP protocol terminated.");
      assert.instanceOf(defect.cause, AcpError.AcpProtocolParseError);
    }),
  );

  it.effect("keeps client send failure messages independent from the cause", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
      });

      const failure = yield* transport.clientProtocol
        .send(0, {
          _tag: "Request",
          id: "request-1",
          tag: "x/test",
          payload: 1n,
          headers: [],
        })
        .pipe(Effect.flip);
      const defect = failure.reason as {
        readonly _tag: string;
        readonly message: string;
        readonly cause: unknown;
      };

      assert.equal(defect._tag, "RpcClientDefect");
      assert.equal(defect.message, "Failed to send ACP protocol message.");
      assert.instanceOf(defect.cause, AcpError.AcpProtocolParseError);
    }),
  );

  it.effect("fails pending extension requests with the propagated exit code", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        terminationError: Effect.succeed(new AcpError.AcpProcessExitedError({ code: 0 })),
        serverRequestMethods: new Set(),
      });

      const response = yield* transport
        .request("x/test", { hello: "world" })
        .pipe(Effect.forkScoped);
      yield* Queue.take(output);
      yield* Queue.end(input);

      const error = yield* Fiber.join(response).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Expected request to fail after process exit"),
        }),
      );
      assert.instanceOf(error, AcpError.AcpProcessExitedError);
      assert.equal(error.code, 0);
    }),
  );
});
