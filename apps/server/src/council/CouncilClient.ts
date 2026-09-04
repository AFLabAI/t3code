/**
 * CouncilClient - HTTP interface to local Python Council backend
 *
 * Manages 3-brain orchestration cycle:
 * Qwen Planner → Gemma Critic → DeepSeek Judge → Decision
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";

// Council contracts
export const CouncilGoal = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  createdAt: Schema.String,
});
export type CouncilGoal = typeof CouncilGoal.Type;

export const CouncilEventType = Schema.Literals([
  "planner_started",
  "planner_completed",
  "critic_started",
  "critic_completed",
  "revision_started",
  "revision_completed",
  "judge_started",
  "judge_completed",
  "decision_ready",
  "error",
]);
export type CouncilEventType = typeof CouncilEventType.Type;

export const CouncilDecisionType = Schema.Literals([
  "EXECUTE",
  "REVISE",
  "RESEARCH",
  "MORE_EVIDENCE",
  "ASK_USER",
  "BLOCKED",
]);
export type CouncilDecisionType = typeof CouncilDecisionType.Type;

export const CouncilEvent = Schema.Struct({
  cycleId: Schema.String,
  eventType: CouncilEventType,
  brain: Schema.optional(Schema.Literals(["PLANNER", "CRITIC", "REVISION", "JUDGE"])),
  content: Schema.String,
  timestamp: Schema.String,
});
export type CouncilEvent = typeof CouncilEvent.Type;

export const CouncilDecision = Schema.Struct({
  cycleId: Schema.String,
  decision: CouncilDecisionType,
  reasoning: Schema.String,
  executionProposal: Schema.optional(Schema.String),
  riskLevel: Schema.optional(Schema.Literals(["LOW", "MEDIUM", "HIGH", "CRITICAL"])),
  requiresApproval: Schema.Boolean,
});
export type CouncilDecision = typeof CouncilDecision.Type;

// Client service
export interface CouncilClientShape {
  submitGoal(goal: CouncilGoal): Effect.Effect<string, Error>; // returns cycleId
  getCycleStatus(cycleId: string): Effect.Effect<CouncilEvent[], Error>;
  getDecision(cycleId: string): Effect.Effect<CouncilDecision, Error>;
  health(): Effect.Effect<boolean, Error>;
}

const CouncilResponseSchema = Schema.Struct({ cycleId: Schema.String });
const CouncilErrorSchema = Schema.Struct({ detail: Schema.String });

export class CouncilClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = "http://127.0.0.1:8000") {
    this.baseUrl = baseUrl;
  }

  submitGoal = (goal: CouncilGoal): Effect.Effect<string, Error> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const goalJson = yield* Schema.encode(CouncilGoal)(goal);
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${baseUrl}/api/goal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: goalJson,
          }),
        catch: (e) => new Error(`Council submit fetch failed: ${String(e)}`),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => "unknown error",
        });
        return yield* Effect.fail(new Error(`Council submit failed: ${response.status} ${text}`));
      }

      const responseText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (e) => new Error(`Failed to read response: ${String(e)}`),
      });
      const data = yield* Schema.parseJson(CouncilResponseSchema)(responseText);
      return data.cycleId;
    });
  };

  getCycleStatus = (cycleId: string): Effect.Effect<CouncilEvent[], Error> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${baseUrl}/api/transcript?cycleId=${cycleId}`),
        catch: (e) => new Error(`Council transcript fetch failed: ${String(e)}`),
      });

      if (!response.ok) {
        return yield* Effect.fail(new Error(`Council transcript fetch failed: ${response.status}`));
      }

      const responseText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (e) => new Error(`Failed to read response: ${String(e)}`),
      });
      const data = yield* Schema.parseJson(Schema.Array(CouncilEvent))(responseText);
      return data;
    });
  };

  getDecision = (cycleId: string): Effect.Effect<CouncilDecision, Error> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${baseUrl}/api/decision?cycleId=${cycleId}`),
        catch: (e) => new Error(`Council decision fetch failed: ${String(e)}`),
      });

      if (!response.ok) {
        return yield* Effect.fail(new Error(`Council decision fetch failed: ${response.status}`));
      }

      const responseText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (e) => new Error(`Failed to read response: ${String(e)}`),
      });
      const data = yield* Schema.parseJson(CouncilDecision)(responseText);
      return data;
    });
  };

  health = (): Effect.Effect<boolean, Error> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      return yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${baseUrl}/api/health`, {
            signal: AbortSignal.timeout(3000),
          });
          return response.ok;
        },
        catch: () => false,
      });
    });
  };
}
