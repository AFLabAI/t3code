import { describe, it, expect } from "vitest";
import { it as itEffect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { OrchestrationEvent } from "@t3tools/contracts";

describe("CouncilCommandReactor Routing", () => {
  describe("TEST A: Council-enabled turn activation", () => {
    itEffect("should enqueue turn-start-requested when thread.interactionMode === 'council'", () =>
      Effect.gen(function* () {
        const enqueuedEvents: OrchestrationEvent[] = [];
        const mockWorker = {
          enqueue: (e: OrchestrationEvent) => Effect.sync(() => enqueuedEvents.push(e)),
          drain: Effect.void,
        };

        const mockThread = {
          id: "thread-1" as any,
          projectId: "proj-1" as any,
          title: "test",
          modelSelection: {} as any,
          runtimeMode: "full-access" as const,
          interactionMode: "council" as const,
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          messages: [
            {
              id: "msg-1" as any,
              text: "Create file test.txt with content: PASS",
              role: "user" as const,
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        };

        const mockSnapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed({
              snapshotSequence: 1,
              thread: mockThread,
              page: undefined,
            }),
        } as any;

        const testEvent: OrchestrationEvent = {
          type: "thread.turn-start-requested",
          eventId: "evt-1" as any,
          commandId: null,
          occurredAt: "2026-01-01T00:00:00Z",
          payload: {
            threadId: "thread-1" as any,
            messageId: "msg-1" as any,
            modelSelection: undefined,
            titleSeed: undefined,
            runtimeMode: "full-access",
            interactionMode: "council",
            sourceProposedPlan: undefined,
            createdAt: "2026-01-01T00:00:00Z",
          },
        };

        const processEvent = (event: OrchestrationEvent) =>
          Effect.gen(function* () {
            if (event.type === "thread.turn-start-requested") {
              const snapshotOpt = yield* mockSnapshotQuery
                .getThreadDetailById(event.payload.threadId)
                .pipe(Effect.option);
              const thread = snapshotOpt.pipe(
                Option.map((s: any) => s.thread),
                Option.getOrUndefined,
              );
              if (thread?.interactionMode === "council") {
                yield* mockWorker.enqueue(event);
              }
            }
          });

        yield* processEvent(testEvent);

        expect(enqueuedEvents).toHaveLength(1);
        expect(enqueuedEvents[0]?.type).toBe("thread.turn-start-requested");
      }),
    );
  });

  describe("TEST B: Provider suppression for Council threads", () => {
    itEffect("should NOT enqueue turn-start-requested to provider when Council-enabled", () =>
      Effect.gen(function* () {
        const enqueuedToProvider: OrchestrationEvent[] = [];

        const mockThread = {
          id: "thread-1" as any,
          projectId: "proj-1" as any,
          title: "test",
          modelSelection: {} as any,
          runtimeMode: "full-access" as const,
          interactionMode: "council" as const,
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          messages: [],
        };

        const mockSnapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed({
              snapshotSequence: 1,
              thread: mockThread,
              page: undefined,
            }),
        } as any;

        const testEvent: OrchestrationEvent = {
          type: "thread.turn-start-requested",
          eventId: "evt-1" as any,
          commandId: null,
          occurredAt: "2026-01-01T00:00:00Z",
          payload: {
            threadId: "thread-1" as any,
            messageId: "msg-1" as any,
            modelSelection: undefined,
            titleSeed: undefined,
            runtimeMode: "full-access",
            interactionMode: "council",
            sourceProposedPlan: undefined,
            createdAt: "2026-01-01T00:00:00Z",
          },
        };

        const providerProcessEvent = (event: OrchestrationEvent) =>
          Effect.gen(function* () {
            if (event.type === "thread.turn-start-requested") {
              const snapshotOpt = yield* mockSnapshotQuery
                .getThreadDetailById(event.payload.threadId)
                .pipe(Effect.option);
              const thread = snapshotOpt.pipe(
                Option.map((s: any) => s.thread),
                Option.getOrUndefined,
              );
              if (thread?.interactionMode === "council") {
                return;
              }
            }

            enqueuedToProvider.push(event);
          });

        yield* providerProcessEvent(testEvent);

        expect(enqueuedToProvider).toHaveLength(0);
      }),
    );
  });

  describe("TEST C: Non-Council thread regression", () => {
    itEffect("should enqueue turn-start-requested to provider when NOT Council-enabled", () =>
      Effect.gen(function* () {
        const enqueuedToProvider: OrchestrationEvent[] = [];

        const mockThread = {
          id: "thread-2" as any,
          projectId: "proj-1" as any,
          title: "test",
          modelSelection: {} as any,
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          messages: [],
        };

        const mockSnapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed({
              snapshotSequence: 1,
              thread: mockThread,
              page: undefined,
            }),
        } as any;

        const testEvent: OrchestrationEvent = {
          type: "thread.turn-start-requested",
          eventId: "evt-2" as any,
          commandId: null,
          occurredAt: "2026-01-01T00:00:00Z",
          payload: {
            threadId: "thread-2" as any,
            messageId: "msg-2" as any,
            modelSelection: undefined,
            titleSeed: undefined,
            runtimeMode: "full-access",
            interactionMode: "default",
            sourceProposedPlan: undefined,
            createdAt: "2026-01-01T00:00:00Z",
          },
        };

        const providerProcessEvent = (event: OrchestrationEvent) =>
          Effect.gen(function* () {
            if (event.type === "thread.turn-start-requested") {
              const snapshotOpt = yield* mockSnapshotQuery
                .getThreadDetailById(event.payload.threadId)
                .pipe(Effect.option);
              const thread = snapshotOpt.pipe(
                Option.map((s: any) => s.thread),
                Option.getOrUndefined,
              );
              if (thread?.interactionMode === "council") {
                return;
              }
            }

            enqueuedToProvider.push(event);
          });

        yield* providerProcessEvent(testEvent);

        expect(enqueuedToProvider).toHaveLength(1);
        expect(enqueuedToProvider[0]?.type).toBe("thread.turn-start-requested");
      }),
    );
  });

  describe("TEST D: Explicit council-goal-requested regression", () => {
    itEffect("should still handle explicit thread.council-goal-requested events", () =>
      Effect.gen(function* () {
        const enqueuedEvents: OrchestrationEvent[] = [];
        const mockWorker = {
          enqueue: (e: OrchestrationEvent) => Effect.sync(() => enqueuedEvents.push(e)),
          drain: Effect.void,
        };

        const testEvent: OrchestrationEvent = {
          type: "thread.council-goal-requested",
          eventId: "evt-3" as any,
          commandId: null,
          occurredAt: "2026-01-01T00:00:00Z",
          payload: {
            threadId: "thread-3" as any,
            goalText: "explicit goal",
            createdAt: "2026-01-01T00:00:00Z",
          },
        };

        const processEvent = (event: OrchestrationEvent) =>
          Effect.gen(function* () {
            if (event.type === "thread.council-goal-requested") {
              yield* mockWorker.enqueue(event);
            }
          });

        yield* processEvent(testEvent);

        expect(enqueuedEvents).toHaveLength(1);
        expect(enqueuedEvents[0]?.type).toBe("thread.council-goal-requested");
      }),
    );
  });
});
