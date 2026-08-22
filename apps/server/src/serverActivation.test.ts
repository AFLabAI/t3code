import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { forkParked, forkParkedStream, ServerActivation } from "./serverActivation.ts";

it.effect("proves a root is parked before returning and releases it with one gate", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activation = yield* Deferred.make<void>();
      const ran = yield* Deferred.make<void>();

      yield* forkParked(Deferred.succeed(ran, undefined)).pipe(
        Effect.provideService(ServerActivation, Deferred.await(activation)),
      );
      expect(yield* Deferred.isDone(ran)).toBe(false);

      yield* Deferred.succeed(activation, undefined);
      yield* Deferred.await(ran);
      expect(yield* Deferred.isDone(ran)).toBe(true);
    }),
  ),
);

it.effect(
  "subscribes before activation and receives events published at the activation boundary",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* Deferred.make<void>();
        const received = yield* Deferred.make<number>();
        const events = yield* PubSub.unbounded<number>();

        yield* forkParkedStream(Stream.fromPubSub(events), (event) =>
          Deferred.succeed(received, event).pipe(Effect.asVoid),
        ).pipe(Effect.provideService(ServerActivation, Deferred.await(activation)));

        yield* PubSub.publish(events, 7);
        expect(yield* Deferred.isDone(received)).toBe(false);

        yield* Deferred.succeed(activation, undefined);
        expect(yield* Deferred.await(received)).toBe(7);
      }),
    ),
);

it.effect("subscribes immediately when no activation gate is configured", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const received = yield* Deferred.make<number>();
      const events = yield* PubSub.unbounded<number>();

      yield* forkParkedStream(Stream.fromPubSub(events), (event) =>
        Deferred.succeed(received, event).pipe(Effect.asVoid),
      );
      yield* PubSub.publish(events, 11);

      expect(yield* Deferred.await(received)).toBe(11);
    }),
  ),
);
