import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as CodexError from "./errors.ts";
import * as CodexProtocol from "./protocol.ts";
import * as CodexRpc from "./rpc.ts";
import * as CodexSchema from "./schema.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const encoder = new TextEncoder();

const encodeJsonl = (value: unknown) => encoder.encode(`${encodeUnknownJsonString(value)}\n`);

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeAccountTokenUsageResponse = Schema.decodeUnknownEffect(
  CodexRpc.CLIENT_REQUEST_RESPONSES["account/usage/read"],
);
const decodeAccountRateLimitsResponse = Schema.decodeUnknownEffect(
  CodexRpc.CLIENT_REQUEST_RESPONSES["account/rateLimits/read"],
);
const decodeConsumeRateLimitResetCreditParams = Schema.decodeUnknownEffect(
  CodexRpc.CLIENT_REQUEST_PARAMS["account/rateLimitResetCredit/consume"],
);
const decodeConsumeRateLimitResetCreditResponse = Schema.decodeUnknownEffect(
  CodexRpc.CLIENT_REQUEST_RESPONSES["account/rateLimitResetCredit/consume"],
);

it.layer(NodeServices.layer)("effect-codex-app-server protocol", (it) => {
  it.effect("maps account usage responses to the upstream token usage schema", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        CodexRpc.CLIENT_REQUEST_RESPONSES["account/usage/read"],
        CodexSchema.V2GetAccountTokenUsageResponse,
      );
      const decoded = yield* decodeAccountTokenUsageResponse({
        dailyUsageBuckets: [{ startDate: "2026-06-10", tokens: 42 }],
        summary: { lifetimeTokens: 42 },
      });
      assert.deepEqual(decoded, {
        dailyUsageBuckets: [{ startDate: "2026-06-10", tokens: 42 }],
        summary: { lifetimeTokens: 42 },
      });
    }),
  );

  it.effect("maps earned rate-limit reset credits from account rate-limit snapshots", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        CodexRpc.CLIENT_REQUEST_RESPONSES["account/rateLimits/read"],
        CodexSchema.V2GetAccountRateLimitsResponse,
      );

      const response = {
        rateLimits: {},
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            {
              id: "RateLimitResetCredit_1",
              resetType: "codexRateLimits",
              status: "available",
              grantedAt: 1_781_654_400,
              expiresAt: 1_784_246_400,
              title: "Full reset",
              description: "Ready to redeem",
            },
            {
              id: "RateLimitResetCredit_2",
              resetType: "unknown",
              status: "unknown",
              grantedAt: 1_781_654_401,
              expiresAt: null,
            },
          ],
        },
      } as const;

      assert.deepEqual(yield* decodeAccountRateLimitsResponse(response), response);
      assert.deepEqual(
        yield* decodeAccountRateLimitsResponse({
          rateLimits: {},
          rateLimitResetCredits: { availableCount: 2, credits: null },
        }),
        {
          rateLimits: {},
          rateLimitResetCredits: { availableCount: 2, credits: null },
        },
      );
    }),
  );

  it.effect("maps the earned rate-limit reset consume request and response", () =>
    Effect.gen(function* () {
      assert.equal(
        CodexRpc.CLIENT_REQUEST_METHODS["account/rateLimitResetCredit/consume"],
        "account/rateLimitResetCredit/consume",
      );
      assert.strictEqual(
        CodexRpc.CLIENT_REQUEST_PARAMS["account/rateLimitResetCredit/consume"],
        CodexSchema.V2ConsumeAccountRateLimitResetCreditParams,
      );
      assert.strictEqual(
        CodexRpc.CLIENT_REQUEST_RESPONSES["account/rateLimitResetCredit/consume"],
        CodexSchema.V2ConsumeAccountRateLimitResetCreditResponse,
      );

      assert.deepEqual(
        yield* decodeConsumeRateLimitResetCreditParams({
          idempotencyKey: "8ae96ff3-3425-4f4c-8772-b6fd61502868",
          creditId: "RateLimitResetCredit_1",
        }),
        {
          idempotencyKey: "8ae96ff3-3425-4f4c-8772-b6fd61502868",
          creditId: "RateLimitResetCredit_1",
        },
      );
      assert.deepEqual(yield* decodeConsumeRateLimitResetCreditResponse({ outcome: "reset" }), {
        outcome: "reset",
      });
    }),
  );

  it.effect(
    "encodes requests without a jsonrpc field and routes inbound requests and notifications",
    () =>
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({ stdio });

        const notificationDeferred =
          yield* Deferred.make<ReadonlyArray<CodexProtocol.CodexAppServerIncomingNotification>>();
        const requestDeferred =
          yield* Deferred.make<ReadonlyArray<CodexProtocol.CodexAppServerIncomingRequest>>();

        yield* transport.incomingNotifications.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.flatMap((notifications) => Deferred.succeed(notificationDeferred, notifications)),
          Effect.forkScoped,
        );

        yield* transport.incomingRequests.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.flatMap((requests) => Deferred.succeed(requestDeferred, requests)),
          Effect.forkScoped,
        );

        yield* transport.notify("initialized");
        assert.equal(yield* Queue.take(output), '{"method":"initialized"}\n');

        const initializeParams = {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        };

        const pendingInitialize = yield* transport
          .request("initialize", initializeParams)
          .pipe(Effect.forkScoped);
        assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
          id: 1,
          method: "initialize",
          params: initializeParams,
        });

        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "item/agentMessage/delta",
            params: {
              delta: "Hello from the mock peer.",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: 77,
            method: "item/tool/requestUserInput",
            params: {
              itemId: "item-approval-1",
              threadId: "thread-1",
              turnId: "turn-1",
              questions: [
                {
                  id: "approved",
                  header: "Approve",
                  question: "Continue?",
                },
              ],
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: 1,
            result: {
              userAgent: "mock-codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            },
          }),
        );

        assert.deepEqual(yield* Fiber.join(pendingInitialize), {
          userAgent: "mock-codex-app-server",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos",
        });
        assert.deepEqual(yield* Deferred.await(notificationDeferred), [
          {
            method: "item/agentMessage/delta",
            params: {
              delta: "Hello from the mock peer.",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          },
        ]);
        assert.deepEqual(yield* Deferred.await(requestDeferred), [
          {
            id: 77,
            method: "item/tool/requestUserInput",
            params: {
              itemId: "item-approval-1",
              threadId: "thread-1",
              turnId: "turn-1",
              questions: [
                {
                  id: "approved",
                  header: "Approve",
                  question: "Continue?",
                },
              ],
            },
          },
        ]);

        yield* transport.respond(77, {
          answers: {
            approved: {
              answers: ["yes"],
            },
          },
        });
        assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
          id: 77,
          result: {
            answers: {
              approved: {
                answers: ["yes"],
              },
            },
          },
        });

        yield* transport.respondError(
          78,
          CodexError.CodexAppServerRequestError.methodNotFound("x/test"),
        );
        assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
          id: 78,
          error: {
            code: -32601,
            message: "Method not found: x/test",
          },
        });
      }),
  );

  it.effect("surfaces JSON encoding failures as protocol parse errors", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({ stdio });

      const bigintError = yield* transport.notify("x/test", 1n).pipe(Effect.flip);
      assert.instanceOf(bigintError, CodexError.CodexAppServerProtocolParseError);
      assert.equal(bigintError.operation, "encode-wire-message");
      assert.equal(bigintError.method, "x/test");
      assert.exists(bigintError.cause);
      assert.equal(
        bigintError.message,
        "Codex App Server protocol operation 'encode-wire-message' failed for method 'x/test'.",
      );

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const circularError = yield* transport.notify("x/test", circular).pipe(Effect.flip);
      assert.instanceOf(circularError, CodexError.CodexAppServerProtocolParseError);
      assert.equal(circularError.operation, "encode-wire-message");
      assert.equal(circularError.method, "x/test");
      assert.exists(circularError.cause);

      const requestError = yield* transport.request("x/request", 1n).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Expected request encoding to fail"),
        }),
      );
      assert.instanceOf(requestError, CodexError.CodexAppServerProtocolParseError);
      assert.deepInclude(requestError, {
        operation: "encode-wire-message",
        method: "x/request",
        requestId: "1",
      });
    }),
  );

  it.effect("correlates response errors with the originating request", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({ stdio });

      const response = yield* transport.request("thread/start", {}).pipe(Effect.forkScoped);
      yield* Queue.take(output);
      yield* Queue.offer(
        input,
        encodeJsonl({
          id: 1,
          error: {
            code: -32602,
            message: "Invalid params",
            data: { field: "cwd" },
          },
        }),
      );

      const error = yield* Fiber.join(response).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => assert.fail("Expected Codex App Server request to fail"),
        }),
      );
      assert.instanceOf(error, CodexError.CodexAppServerRequestError);
      assert.deepInclude(error, {
        code: -32602,
        errorMessage: "Invalid params",
        method: "thread/start",
        requestId: "1",
        operation: "receive-response",
      });
    }),
  );

  it.effect("logs decode failures without copying the cause or wire payload", () =>
    Effect.gen(function* () {
      const secret = "codex-wire-secret-sentinel";
      const { stdio, input } = yield* makeInMemoryStdio();
      const events: Array<CodexProtocol.CodexAppServerProtocolLogEvent> = [];
      const termination = yield* Deferred.make<CodexError.CodexAppServerError>();
      yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
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
      assert.exists(event);
      assert.equal(event.direction, "incoming");
      const payload = event.payload as Record<string, unknown>;
      assert.equal(payload.operation, "decode-wire-message");
      assert.isNumber(payload.issueCount);
      assert.isArray(payload.issueKinds);
      assert.isNumber(payload.maximumPathDepth);
      assert.equal("cause" in payload, false);
      assert.equal("detail" in payload, false);
      assert.notInclude(encodeUnknownJsonString(event), secret);
    }),
  );

  it.effect("describes unroutable messages with safe structural diagnostics", () =>
    Effect.gen(function* () {
      const secret = "codex-unroutable-secret-sentinel";
      const { stdio, input } = yield* makeInMemoryStdio();
      const termination = yield* Deferred.make<CodexError.CodexAppServerError>();
      yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* Queue.offer(
        input,
        encodeJsonl({ id: true, method: "thread/start", params: { token: secret } }),
      );

      const error = yield* Deferred.await(termination);
      assert.instanceOf(error, CodexError.CodexAppServerProtocolParseError);
      assert.deepInclude(error, {
        operation: "route-wire-message",
        method: "thread/start",
        payloadKind: "object",
        presentFields: ["id", "method", "params"],
      });
      assert.isUndefined(error.requestId);
      assert.notProperty(error, "detail");
      assert.notProperty(error, "cause");
      assert.notInclude(error.message, secret);
    }),
  );

  it.effect("classifies an input stream ending without inventing a cause", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const termination = yield* Deferred.make<CodexError.CodexAppServerError>();
      yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      yield* Queue.end(input);

      const error = yield* Deferred.await(termination);
      assert.instanceOf(error, CodexError.CodexAppServerInputStreamEndedError);
      assert.equal(error.message, "Codex App Server input stream ended.");
      assert.equal("cause" in error, false);
    }),
  );

  it.effect("rejects new requests and notifications after the input stream ends", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const termination = yield* Deferred.make<CodexError.CodexAppServerError>();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
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
      const termination = yield* Deferred.make<CodexError.CodexAppServerError>();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
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

  it.effect("drains buffered raw streams and completes when the input stream ends", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const handled = yield* Deferred.make<void>();
      const observedNotifications = yield* Ref.make<Array<unknown>>([]);
      const observedRequests = yield* Ref.make<Array<string | number>>([]);
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        onNotification: () => Deferred.succeed(handled, undefined).pipe(Effect.asVoid),
      });

      yield* Queue.offer(input, encodeJsonl({ id: 7, method: "x/request", params: 7 }));
      yield* Queue.offer(input, encodeJsonl({ method: "x/notification", params: 8 }));
      yield* Deferred.await(handled);

      const notificationDrain = yield* transport.incomingNotifications.pipe(
        Stream.tap((notification) =>
          Ref.update(observedNotifications, (current) => [...current, notification.params]),
        ),
        Stream.runDrain,
        Effect.forkScoped,
      );
      const requestDrain = yield* transport.incomingRequests.pipe(
        Stream.tap((request) =>
          Ref.update(observedRequests, (current) => [...current, request.id]),
        ),
        Stream.runDrain,
        Effect.forkScoped,
      );

      yield* Queue.end(input);
      yield* Effect.all([Fiber.join(notificationDrain), Fiber.join(requestDrain)], {
        discard: true,
      });

      assert.deepEqual(yield* Ref.get(observedNotifications), [8]);
      assert.deepEqual(yield* Ref.get(observedRequests), [7]);
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
      const termination = yield* Deferred.make<CodexError.CodexAppServerError>();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio: Stdio.make({
          args: stdio.args,
          stdin: stdio.stdin,
          stdout: () => Sink.forEach((_chunk: string | Uint8Array) => Effect.fail(cause)),
          stderr: stdio.stderr,
        }),
        onTermination: (error) => Deferred.succeed(termination, error).pipe(Effect.asVoid),
      });

      const pending = yield* transport.request("x/pending", {}).pipe(Effect.forkScoped);
      const error = yield* Deferred.await(termination);

      assert.instanceOf(error, CodexError.CodexAppServerTransportError);
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

  it.effect("bounds handled requests and notifications retained for raw streams", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const handled = yield* Deferred.make<void>();
      const handledRequests = yield* Ref.make(0);
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        onRequest: () => Ref.update(handledRequests, (count) => count + 1).pipe(Effect.as({})),
        onNotification: (notification) =>
          notification.params === 95
            ? Deferred.succeed(handled, undefined).pipe(Effect.asVoid)
            : Effect.void,
      });

      yield* Effect.forEach(
        Array.from({ length: 96 }, (_, index) => index),
        (index) =>
          Effect.all(
            [
              Queue.offer(input, encodeJsonl({ id: index, method: "x/request", params: index })),
              Queue.offer(input, encodeJsonl({ method: "x/notification", params: index })),
            ],
            { discard: true },
          ),
        { discard: true },
      );
      yield* Deferred.await(handled);

      const notifications = yield* transport.incomingNotifications.pipe(
        Stream.take(64),
        Stream.runCollect,
      );
      const requests = yield* transport.incomingRequests.pipe(Stream.take(64), Stream.runCollect);

      assert.equal(notifications.length, 64);
      assert.equal(notifications[0]?.params, 32);
      assert.equal(notifications[63]?.params, 95);
      assert.equal(yield* Ref.get(handledRequests), 96);
      assert.equal(requests.length, 64);
      assert.equal(requests[0]?.id, 32);
      assert.equal(requests[63]?.id, 95);
    }),
  );

  it.effect("preserves request bursts beyond the bounded raw queue capacity", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const queueFull = yield* Deferred.make<void>();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        logIncoming: true,
        logger: (event) =>
          event.stage === "decoded" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "id" in event.payload &&
          event.payload.id === 64
            ? Deferred.succeed(queueFull, undefined).pipe(Effect.asVoid)
            : Effect.void,
      });

      yield* Effect.forEach(
        Array.from({ length: 96 }, (_, index) => index),
        (index) => Queue.offer(input, encodeJsonl({ id: index, method: "x/request" })),
        { discard: true },
      );
      yield* Deferred.await(queueFull);

      const requests = yield* transport.incomingRequests.pipe(Stream.take(96), Stream.runCollect);

      assert.deepEqual(
        requests.map((request) => request.id),
        Array.from({ length: 96 }, (_, index) => index),
      );
    }),
  );
});
