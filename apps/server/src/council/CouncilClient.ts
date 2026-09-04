/**
 * CouncilClient - HTTP interface to local Python Council backend
 *
 * Manages 3-brain orchestration cycle:
 * Qwen Planner → Gemma Critic → DeepSeek Judge → Decision
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpBody } from "effect/unstable/http";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
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
  submitGoal(goal: CouncilGoal): Effect.Effect<string, Error, HttpClient.HttpClient>; // returns cycleId
  getCycleStatus(cycleId: string): Effect.Effect<CouncilEvent[], Error, HttpClient.HttpClient>;
  getDecision(cycleId: string): Effect.Effect<CouncilDecision, Error, HttpClient.HttpClient>;
  health(): Effect.Effect<boolean, Error, HttpClient.HttpClient>;
}

const CouncilResponseSchema = Schema.Struct({ cycleId: Schema.String });
const encodeGoal = Schema.encodeEffect(CouncilGoal);

export class CouncilClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = "http://127.0.0.1:8000") {
    this.baseUrl = baseUrl;
  }

  submitGoal = (goal: CouncilGoal): Effect.Effect<string, Error, HttpClient.HttpClient> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const encodedGoal = yield* encodeGoal(goal);
      const body = yield* HttpBody.json(encodedGoal);
      const data = yield* HttpClientRequest.post(`${baseUrl}/api/goal`, {
        headers: { "Content-Type": "application/json" },
        body,
      }).pipe(
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(CouncilResponseSchema)),
      );
      return data.cycleId;
    });
  };

  getCycleStatus = (
    cycleId: string,
  ): Effect.Effect<CouncilEvent[], Error, HttpClient.HttpClient> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const events = yield* HttpClientRequest.get(
        `${baseUrl}/api/transcript?cycleId=${cycleId}`,
      ).pipe(
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(CouncilEvent))),
      );
      return Array.from(events);
    });
  };

  getDecision = (cycleId: string): Effect.Effect<CouncilDecision, Error, HttpClient.HttpClient> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return yield* HttpClientRequest.get(`${baseUrl}/api/decision?cycleId=${cycleId}`).pipe(
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(CouncilDecision)),
      );
    });
  };

  health = (): Effect.Effect<boolean, Error, HttpClient.HttpClient> => {
    const baseUrl = this.baseUrl;
    return Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return yield* HttpClientRequest.get(`${baseUrl}/api/health`).pipe(
        httpClient.execute,
        Effect.map((response) => response.status === 200),
        Effect.catch(() => Effect.succeed(false)),
      );
    });
  };
}
