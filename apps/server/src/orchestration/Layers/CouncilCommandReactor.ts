import {
  CommandId,
  EventId,
  type OrchestrationEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  CouncilClient,
  type CouncilDecision,
  type CouncilEvent,
  type CouncilGoal,
} from "../../council/CouncilClient.ts";
import { increment, orchestrationEventsProcessedTotal } from "../../observability/Metrics.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  CouncilCommandReactor,
  type CouncilCommandReactorShape,
} from "../Services/CouncilCommandReactor.ts";
import { forkParked, ServerActivation } from "../../serverActivation.ts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

type CouncilIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.council-goal-requested"
      | "thread.turn-start-requested"
      | "thread.session-stop-requested";
  }
>;

const COUNCIL_POLL_INTERVAL = Duration.millis(500);
const COUNCIL_POLL_TIMEOUT = Duration.seconds(120);

type CouncilCycleState = {
  cycleId: string;
  goalText: string;
  threadId: ThreadId;
  events: CouncilEvent[];
  decision?: CouncilDecision;
  status: "polling" | "complete" | "failed";
};

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));

  const councilClient = new CouncilClient();

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map((opt) => opt.toUndefined?.()));
  });

  const emitCouncilEvent = (input: {
    threadId: ThreadId;
    councilEventType: string;
    brain?: string;
    content: string;
    cycleId: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("council-event"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "info",
            kind: "council.event",
            summary: `Council ${input.councilEventType}`,
            payload: {
              brain: input.brain,
              content: input.content,
              cycleId: input.cycleId,
              councilEventType: input.councilEventType,
            },
            turnId: null,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        }),
      ),
    );

  const createExecutionCandidate = (input: {
    threadId: ThreadId;
    cycleId: string;
    goal: string;
    decision: CouncilDecision;
  }) =>
    Effect.all({
      commandId: serverCommandId("council-execution-candidate"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: input.decision.riskLevel === "CRITICAL" || input.decision.riskLevel === "HIGH"
              ? "warning"
              : "info",
            kind: "council.execution-candidate",
            summary: `Council Decision: ${input.decision.decision}`,
            payload: {
              cycleId: input.cycleId,
              decision: input.decision.decision,
              reasoning: input.decision.reasoning,
              proposal: input.decision.executionProposal,
              riskLevel: input.decision.riskLevel,
              requiresApproval: input.decision.requiresApproval,
            },
            turnId: null,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        }),
      ),
    );

  const emitCouncilFailure = (input: {
    threadId: ThreadId;
    summary: string;
    detail: string;
    cycleId?: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("council-failure"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "error",
            kind: "council.error",
            summary: input.summary,
            payload: {
              detail: input.detail,
              ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            },
            turnId: null,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        }),
      ),
    );

  const pollCouncilCycle = Effect.fn("pollCouncilCycle")(function* (
    state: CouncilCycleState,
  ): Effect.Effect<CouncilCycleState, Error, never> {
    const events = yield* councilClient.getCycleStatus(state.cycleId);

    // Emit new events
    const previousEventCount = state.events.length;
    for (const event of events.slice(previousEventCount)) {
      yield* emitCouncilEvent({
        threadId: state.threadId,
        councilEventType: event.eventType,
        brain: event.brain,
        content: event.content,
        cycleId: state.cycleId,
      }).pipe(Effect.catchCause(() => Effect.void));
    }

    // Check if decision is ready
    const isDecisionReady = events.some((e) => e.eventType === "decision_ready");
    if (isDecisionReady && !state.decision) {
      const decision = yield* councilClient.getDecision(state.cycleId);
      return {
        ...state,
        events,
        decision,
        status: "complete" as const,
      };
    }

    return {
      ...state,
      events,
    };
  });

  const waitForCouncilDecision = Effect.fn("waitForCouncilDecision")(function* (
    cycleId: string,
    threadId: ThreadId,
    maxWaitTime: Duration.Duration,
  ): Effect.Effect<CouncilDecision, Error, never> {
    let state: CouncilCycleState = {
      cycleId,
      goalText: "",
      threadId,
      events: [],
      status: "polling",
    };

    const startTime = Date.now();
    while (state.status === "polling") {
      const elapsed = Date.now() - startTime;
      if (elapsed > Duration.toMillis(maxWaitTime)) {
        return yield* new Error(
          `Council decision timeout after ${Duration.toMillis(maxWaitTime)}ms for cycle ${cycleId}`,
        );
      }

      state = yield* pollCouncilCycle(state);

      if (state.status === "complete" && state.decision) {
        return state.decision;
      }

      // Backoff before next poll
      yield* Effect.sleep(COUNCIL_POLL_INTERVAL);
    }

    return yield* new Error(`Council cycle ${cycleId} failed to complete`);
  });

  const handleCouncilGoal = Effect.fn("handleCouncilGoal")(function* (input: {
    threadId: ThreadId;
    goalText: string;
    createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      yield* emitCouncilFailure({
        threadId: input.threadId,
        summary: "Council goal rejected",
        detail: `Thread ${input.threadId} not found`,
      });
      return;
    }

    // Construct CouncilGoal
    const councilGoal: CouncilGoal = {
      threadId: input.threadId,
      text: input.goalText,
      createdAt: input.createdAt,
    };

    // Submit to Council
    const cycleId = yield* councilClient.submitGoal(councilGoal).pipe(
      Effect.catchCause((cause) => {
        const detail = Cause.pretty(cause);
        return emitCouncilFailure({
          threadId: input.threadId,
          summary: "Council goal submission failed",
          detail,
        }).pipe(Effect.andThen(() => Effect.fail(new Error(detail))));
      }),
    );

    // Poll for decision
    const decision = yield* waitForCouncilDecision(cycleId, input.threadId, COUNCIL_POLL_TIMEOUT)
      .pipe(
        Effect.catchCause((cause) => {
          const detail = Cause.pretty(cause);
          return emitCouncilFailure({
            threadId: input.threadId,
            summary: "Council decision retrieval failed",
            detail,
            cycleId,
          }).pipe(Effect.andThen(() => Effect.fail(new Error(detail))));
        }),
      );

    // Create ExecutionCandidate for decisions that require it
    yield* createExecutionCandidate({
      threadId: input.threadId,
      cycleId,
      goal: input.goalText,
      decision,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to create execution candidate", {
          cycleId,
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

    // Route based on decision type
    switch (decision.decision) {
      case "EXECUTE":
        // ExecutionCandidate already created, awaiting approval
        break;
      case "ASK_USER":
      case "BLOCKED":
      case "RESEARCH":
      case "MORE_EVIDENCE":
        // Decision recorded in activity, no further action
        break;
      case "REVISE":
        // Could implement revision loop, but for MVP just record
        break;
    }
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (
    event: CouncilIntentEvent,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration.event_type": event.type,
      "orchestration.thread_id": event.payload.threadId,
      ...(event.commandId ? { "orchestration.command_id": event.commandId } : {}),
    });
    yield* increment(orchestrationEventsProcessedTotal, {
      eventType: event.type,
    });

    switch (event.type) {
      case "thread.council-goal-requested":
        yield* handleCouncilGoal({
          threadId: event.payload.threadId,
          goalText: event.payload.goalText,
          createdAt: event.payload.createdAt,
        });
        return;
      case "thread.turn-start-requested":
        // Ignore for now, handled by ProviderCommandReactor
        return;
      case "thread.session-stop-requested":
        // Ignore for now
        return;
    }
  });

  const processDomainEventSafely = (event: CouncilIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning("council command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: CouncilCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (event.type === "thread.council-goal-requested") {
        return yield* worker.enqueue(event);
      }
    });

    yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent));
  });

  return {
    start,
    drain: Effect.gen(function* () {
      yield* worker.drain;
    }),
  } satisfies CouncilCommandReactorShape;
});

export const CouncilCommandReactorLive = Layer.effect(CouncilCommandReactor, make);
