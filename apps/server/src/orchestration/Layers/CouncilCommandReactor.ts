import {
  ApprovalRequestId,
  CommandId,
  EventId,
  type OrchestrationEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";

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
import { forkParked } from "../../serverActivation.ts";
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

const CouncilTimeoutError = (message: string) => ({
  _tag: "CouncilTimeoutError" as const,
  message,
});
type CouncilTimeoutError = ReturnType<typeof CouncilTimeoutError>;

const CouncilCycleError = (message: string) => ({ _tag: "CouncilCycleError" as const, message });
type CouncilCycleError = ReturnType<typeof CouncilCycleError>;

type CouncilCycleState = {
  cycleId: string;
  goalText: string;
  threadId: ThreadId;
  events: readonly CouncilEvent[];
  decision?: CouncilDecision;
  status: "polling" | "complete" | "failed";
};

type ExecutionResult = {
  success: boolean;
  output?: string;
  error?: string;
  proof_file?: string;
};

const parseAndExecuteGoal = (goal: string): ExecutionResult => {
  const match = goal.match(/[Cc]reate\s+file\s+(\S+)\s+with\s+(?:exact\s+)?content:\s*(.+)$/s);
  if (!match || !match[1] || !match[2]) {
    return { success: false, error: "Could not parse file creation intent from goal" };
  }

  const filename = match[1].trim();
  const content = match[2].trim();

  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const sandboxDir = path.join(os.tmpdir(), "ox_sandbox");

    fs.mkdirSync(sandboxDir, { recursive: true });

    const filePath = path.join(sandboxDir, filename);
    fs.writeFileSync(filePath, content, "utf-8");

    return {
      success: true,
      output: `Created ${filename} (${content.length} bytes)`,
      proof_file: filePath,
    };
  } catch (e) {
    return {
      success: false,
      error: `Execution failed: ${String(e)}`,
    };
  }
};

const invokeRealOxExecutor = (input: {
  goal: string;
  cycleId: string;
  threadId: ThreadId;
}): Effect.Effect<ExecutionResult, never> => Effect.sync(() => parseAndExecuteGoal(input.goal));

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));

  const getCurrentIsoString = Effect.map(DateTime.now, DateTime.formatIso);

  const councilClient = new CouncilClient();

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const opt = yield* projectionSnapshotQuery.getThreadDetailById(threadId);
    return opt.pipe(Option.getOrUndefined);
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
      isoString: getCurrentIsoString,
    }).pipe(
      Effect.flatMap(({ commandId, eventId, isoString }) =>
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
              ...(input.brain ? { brain: input.brain } : {}),
              content: input.content,
              cycleId: input.cycleId,
              councilEventType: input.councilEventType,
            },
            turnId: null,
            createdAt: isoString,
          },
          createdAt: isoString,
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
      isoString: getCurrentIsoString,
    }).pipe(
      Effect.flatMap(({ commandId, eventId, isoString }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone:
              input.decision.riskLevel === "CRITICAL" || input.decision.riskLevel === "HIGH"
                ? "error"
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
            createdAt: isoString,
          },
          createdAt: isoString,
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
      isoString: getCurrentIsoString,
    }).pipe(
      Effect.flatMap(({ commandId, eventId, isoString }) =>
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
            createdAt: isoString,
          },
          createdAt: isoString,
        }),
      ),
    );

  const pollCouncilCycle = (
    state: CouncilCycleState,
  ): Effect.Effect<
    CouncilCycleState,
    CouncilTimeoutError | CouncilCycleError | Error,
    HttpClient.HttpClient
  > => {
    return Effect.gen(function* () {
      const events = yield* councilClient.getCycleStatus(state.cycleId);

      for (const event of events.slice(state.events.length)) {
        yield* emitCouncilEvent({
          threadId: state.threadId,
          councilEventType: event.eventType,
          ...(event.brain ? { brain: event.brain } : {}),
          content: event.content,
          cycleId: state.cycleId,
        }).pipe(Effect.catchCause(() => Effect.void));
      }

      const isDecisionReady = events.some((e) => e.eventType === "decision_ready");
      if (isDecisionReady && !state.decision) {
        const decision = yield* councilClient.getDecision(state.cycleId);
        return {
          cycleId: state.cycleId,
          goalText: state.goalText,
          threadId: state.threadId,
          events: events as CouncilEvent[],
          decision,
          status: "complete" as const,
        };
      }

      return {
        cycleId: state.cycleId,
        goalText: state.goalText,
        threadId: state.threadId,
        events: events as CouncilEvent[],
        decision: state.decision,
        status: state.status,
      };
    }) as Effect.Effect<
      CouncilCycleState,
      CouncilTimeoutError | CouncilCycleError | Error,
      HttpClient.HttpClient
    >;
  };

  const waitForCouncilDecision = (
    cycleId: string,
    threadId: ThreadId,
    maxWaitTime: Duration.Duration,
  ): Effect.Effect<
    CouncilDecision,
    CouncilTimeoutError | CouncilCycleError | Error,
    HttpClient.HttpClient
  > =>
    Effect.gen(function* () {
      let state: CouncilCycleState = {
        cycleId,
        goalText: "",
        threadId,
        events: [],
        status: "polling",
      };

      const startTime = yield* Clock.currentTimeMillis;
      while (state.status === "polling") {
        const currentTime = yield* Clock.currentTimeMillis;
        const elapsed = currentTime - startTime;
        if (elapsed > Duration.toMillis(maxWaitTime)) {
          const timeoutError = CouncilTimeoutError(
            `Council decision timeout after ${Duration.toMillis(maxWaitTime)}ms for cycle ${cycleId}`,
          );
          return yield* Effect.fail(timeoutError);
        }

        state = yield* pollCouncilCycle(state);

        if (state.status === "complete" && state.decision) {
          return state.decision;
        }

        yield* Effect.sleep(COUNCIL_POLL_INTERVAL);
      }

      const completeError = CouncilCycleError(`Council cycle ${cycleId} failed to complete`);
      return yield* Effect.fail(completeError);
    });

  const handleCouncilGoal = (input: {
    threadId: ThreadId;
    goalText: string;
    createdAt: string;
  }): Effect.Effect<
    void,
    | CouncilTimeoutError
    | CouncilCycleError
    | Error
    | Cause.Cause<CouncilTimeoutError | CouncilCycleError | Error>,
    HttpClient.HttpClient
  > =>
    Effect.gen(function* () {
      const thread = yield* resolveThread(input.threadId);
      if (!thread) {
        yield* emitCouncilFailure({
          threadId: input.threadId,
          summary: "Council goal rejected",
          detail: `Thread ${input.threadId} not found`,
        });
        return;
      }

      const councilGoal: CouncilGoal = {
        threadId: input.threadId,
        text: input.goalText,
        createdAt: input.createdAt,
      };

      const cycleId = yield* councilClient.submitGoal(councilGoal).pipe(
        Effect.catchCause((cause) => {
          const detail = Cause.pretty(cause);
          return emitCouncilFailure({
            threadId: input.threadId,
            summary: "Council goal submission failed",
            detail,
          }).pipe(Effect.andThen(() => Effect.fail(cause)));
        }),
      );

      const decision = yield* waitForCouncilDecision(
        cycleId,
        input.threadId,
        COUNCIL_POLL_TIMEOUT,
      ).pipe(
        Effect.catchCause((cause) => {
          const detail = Cause.pretty(cause);
          return emitCouncilFailure({
            threadId: input.threadId,
            summary: "Council decision retrieval failed",
            detail,
            cycleId,
          }).pipe(Effect.andThen(() => Effect.fail(cause)));
        }),
      );

      switch (decision.decision) {
        case "EXECUTE": {
          const requiresApproval =
            decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";

          if (requiresApproval) {
            const { approvalRequestId, approvalEventId, isoString } = yield* Effect.all({
              approvalRequestId: serverCommandId("council-approval-request"),
              approvalEventId: serverEventId(),
              isoString: getCurrentIsoString,
            });

            yield* orchestrationEngine
              .dispatch({
                type: "thread.activity.append",
                commandId: approvalRequestId,
                threadId: input.threadId,
                activity: {
                  id: approvalEventId,
                  tone: "approval",
                  kind: "council.approval.requested",
                  summary: `Council Approval Required: ${decision.decision}`,
                  payload: {
                    cycleId,
                    councilCycleId: cycleId,
                    decision: decision.decision,
                    reasoning: decision.reasoning,
                    proposal: decision.executionProposal,
                    riskLevel: decision.riskLevel,
                    goal: input.goalText,
                  },
                  turnId: null,
                  createdAt: isoString,
                },
                createdAt: isoString,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to create council approval request activity", {
                    cycleId,
                    threadId: input.threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              );

            const requestId = yield* crypto.randomUUIDv4.pipe(
              Effect.map((uuid) => ApprovalRequestId.make(`server:council-approval:${uuid}`)),
            );
            const respondCommandId = yield* serverCommandId("council-approval-respond");

            yield* orchestrationEngine
              .dispatch({
                type: "thread.approval.respond",
                commandId: respondCommandId,
                threadId: input.threadId,
                requestId,
                decision: "decline",
                createdAt: isoString,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to emit approval-response-requested", {
                    cycleId,
                    threadId: input.threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              );
          } else {
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

            const executionResult = yield* invokeRealOxExecutor({
              goal: input.goalText,
              cycleId,
              threadId: input.threadId,
            }).pipe(
              Effect.catchCause((cause) => {
                const detail = Cause.pretty(cause);
                return Effect.logWarning("real ox execution failed", {
                  cycleId,
                  cause: detail,
                }).pipe(
                  Effect.andThen(() =>
                    Effect.succeed({
                      success: false,
                      error: detail,
                    } as ExecutionResult),
                  ),
                );
              }),
            );

            if (executionResult.success && executionResult.output) {
              yield* emitCouncilEvent({
                threadId: input.threadId,
                councilEventType: "execution_result",
                brain: "RealOx",
                content: `✓ ${executionResult.output}`,
                cycleId,
              }).pipe(Effect.catchCause(() => Effect.void));
            }
          }
          break;
        }
        case "ASK_USER":
        case "BLOCKED":
        case "RESEARCH":
        case "MORE_EVIDENCE":
          break;
        case "REVISE":
          break;
      }
    });

  const processDomainEvent = (
    event: CouncilIntentEvent,
  ): Effect.Effect<
    void,
    | CouncilTimeoutError
    | CouncilCycleError
    | Error
    | Cause.Cause<CouncilTimeoutError | CouncilCycleError | Error>,
    HttpClient.HttpClient
  > =>
    Effect.gen(function* () {
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
        case "thread.turn-start-requested": {
          if (event.payload.interactionMode === "council") {
            const thread = yield* resolveThread(event.payload.threadId);
            if (thread) {
              const message = thread.messages?.find((m) => m.id === event.payload.messageId);
              if (message) {
                yield* handleCouncilGoal({
                  threadId: event.payload.threadId,
                  goalText: message.text,
                  createdAt: event.payload.createdAt,
                });
              }
            }
          }
          return;
        }
        case "thread.session-stop-requested":
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

  const start: CouncilCommandReactorShape["start"] = () =>
    Effect.gen(function* () {
      const processEvent = (event: OrchestrationEvent): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (event.type === "thread.council-goal-requested") {
            yield* worker.enqueue(event);
          } else if (event.type === "thread.turn-start-requested") {
            const snapshotOpt = yield* projectionSnapshotQuery
              .getThreadDetailById(event.payload.threadId)
              .pipe(Effect.option);
            const thread = snapshotOpt.pipe(
              Option.map((s) => s.thread),
              Option.getOrUndefined,
            );
            if (thread?.interactionMode === "council") {
              yield* worker.enqueue(event);
            }
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
