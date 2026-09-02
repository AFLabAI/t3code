import type { CouncilDecision } from "./CouncilClient.ts";

export type DecisionRoute =
  | { type: "EXECUTE"; requiresApproval: boolean }
  | { type: "ASK_USER" }
  | { type: "BLOCKED" }
  | { type: "RESEARCH" }
  | { type: "MORE_EVIDENCE" }
  | { type: "REVISE" };

export function routeCouncilDecision(decision: CouncilDecision): DecisionRoute {
  switch (decision.decision) {
    case "EXECUTE":
      return {
        type: "EXECUTE",
        requiresApproval: decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL",
      };
    case "ASK_USER":
      return { type: "ASK_USER" };
    case "BLOCKED":
      return { type: "BLOCKED" };
    case "RESEARCH":
      return { type: "RESEARCH" };
    case "MORE_EVIDENCE":
      return { type: "MORE_EVIDENCE" };
    case "REVISE":
      return { type: "REVISE" };
    default:
      const _exhaustive: never = decision.decision;
      throw new Error(`Unknown decision type: ${_exhaustive}`);
  }
}

export function requiresCouncilApproval(decision: CouncilDecision): boolean {
  if (decision.decision !== "EXECUTE") {
    return false;
  }
  return decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
}

export function createExecutionCandidatePayload(input: {
  cycleId: string;
  decision: CouncilDecision;
  goal: string;
}) {
  return {
    cycleId: input.cycleId,
    decision: input.decision.decision,
    reasoning: input.decision.reasoning,
    proposal: input.decision.executionProposal,
    riskLevel: input.decision.riskLevel || "MEDIUM",
    requiresApproval: requiresCouncilApproval(input.decision),
    goal: input.goal,
  };
}

export function mapCouncilEventIdentity(input: {
  cycleId: string;
  eventType: string;
  brain?: string;
}) {
  const identityKey = `${input.cycleId}:${input.eventType}`;
  return {
    key: identityKey,
    displayName: formatEventName(input.eventType, input.brain),
  };
}

function formatEventName(eventType: string, brain?: string): string {
  const baseNames: Record<string, string> = {
    planner_started: "Planner started",
    planner_completed: "Planner completed",
    critic_started: "Critic started",
    critic_completed: "Critic completed",
    revision_started: "Revision started",
    revision_completed: "Revision completed",
    judge_started: "Judge started",
    judge_completed: "Judge completed",
    decision_ready: "Decision ready",
    error: "Error",
  };

  const base = baseNames[eventType] || eventType;
  if (brain) {
    return `${base} (${brain})`;
  }
  return base;
}
