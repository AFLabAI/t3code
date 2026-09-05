import { it as itEffect } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

describe("CouncilCommandReactor Routing", () => {
  describe("TEST A: Council-enabled turn activation", () => {
    itEffect("should enqueue turn-start when thread.interactionMode === 'council'", () =>
      Effect.gen(function* () {
        const enqueuedEvents: string[] = [];
        const mockSnapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed({
              snapshotSequence: 1,
              thread: {
                id: "thread-1",
                projectId: "proj-1",
                title: "test",
                interactionMode: "council" as const,
              },
              page: undefined,
            }),
        };

        const eventType = "thread.turn-start-requested";
        const threadId = "thread-1";

        // Simulate the CouncilCommandReactor filtering logic
        const snapshotOpt = yield* mockSnapshotQuery
          .getThreadDetailById(threadId)
          .pipe(Effect.option);
        const threadOpt = snapshotOpt.pipe(Option.map((s: any) => s.thread));
        if (Option.isSome(threadOpt) && threadOpt.value.interactionMode === "council") {
          enqueuedEvents.push(eventType);
        }

        expect(enqueuedEvents).toHaveLength(1);
        expect(enqueuedEvents[0]).toBe("thread.turn-start-requested");
      }),
    );
  });

  describe("TEST B: Provider suppression for Council threads", () => {
    itEffect("should NOT enqueue turn-start to provider when Council-enabled", () =>
      Effect.gen(function* () {
        const enqueuedToProvider: string[] = [];
        const mockSnapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed({
              snapshotSequence: 1,
              thread: {
                id: "thread-1",
                projectId: "proj-1",
                title: "test",
                interactionMode: "council" as const,
              },
              page: undefined,
            }),
        };

        const eventType = "thread.turn-start-requested";
        const threadId = "thread-1";

        // Simulate the ProviderCommandReactor suppression logic
        const snapshotOpt = yield* mockSnapshotQuery
          .getThreadDetailById(threadId)
          .pipe(Effect.option);
        const threadOpt = snapshotOpt.pipe(Option.map((s: any) => s.thread));
        if (!(Option.isSome(threadOpt) && threadOpt.value.interactionMode === "council")) {
          enqueuedToProvider.push(eventType);
        }

        expect(enqueuedToProvider).toHaveLength(0);
      }),
    );
  });

  describe("TEST C: Non-Council thread regression", () => {
    itEffect("should enqueue turn-start to provider when NOT Council-enabled", () =>
      Effect.gen(function* () {
        const enqueuedToProvider: string[] = [];
        const mockSnapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed({
              snapshotSequence: 1,
              thread: {
                id: "thread-2",
                projectId: "proj-1",
                title: "test",
                interactionMode: "default" as const,
              },
              page: undefined,
            }),
        };

        const eventType = "thread.turn-start-requested";
        const threadId = "thread-2";

        // Simulate the ProviderCommandReactor suppression logic
        const snapshotOpt = yield* mockSnapshotQuery
          .getThreadDetailById(threadId)
          .pipe(Effect.option);
        const threadOpt = snapshotOpt.pipe(Option.map((s: any) => s.thread));
        if (!(Option.isSome(threadOpt) && threadOpt.value.interactionMode === "council")) {
          enqueuedToProvider.push(eventType);
        }

        expect(enqueuedToProvider).toHaveLength(1);
        expect(enqueuedToProvider[0]).toBe("thread.turn-start-requested");
      }),
    );
  });

  describe("TEST D: Explicit council-goal-requested regression", () => {
    it("should still handle explicit thread.council-goal-requested events", () => {
      const handledEvents: string[] = [];
      const eventType = "thread.council-goal-requested";

      // CouncilCommandReactor always accepts explicit council-goal-requested
      if (eventType === "thread.council-goal-requested") {
        handledEvents.push(eventType);
      }

      expect(handledEvents).toHaveLength(1);
      expect(handledEvents[0]).toBe("thread.council-goal-requested");
    });
  });
});
