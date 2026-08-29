import { describe, it } from "node:test";
import assert from "node:assert";
import {
  routeCouncilDecision,
  requiresCouncilApproval,
  createExecutionCandidatePayload,
  mapCouncilEventIdentity,
} from "../apps/server/src/council/CouncilDecisionRouter.ts";
import type { CouncilDecision } from "../apps/server/src/council/CouncilClient.ts";

describe("CouncilDecisionRouter - Pure functions", () => {
  describe("Decision routing", () => {
    it("routes EXECUTE decision with LOW risk to execute without approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "EXECUTE",
        reasoning: "Safe to execute",
        executionProposal: "run task",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "EXECUTE");
      assert.strictEqual(route.requiresApproval, false);
    });

    it("routes EXECUTE decision with HIGH risk to require approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-2",
        decision: "EXECUTE",
        reasoning: "High risk",
        executionProposal: "run sensitive",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "EXECUTE");
      assert.strictEqual(route.requiresApproval, true);
    });

    it("routes EXECUTE decision with CRITICAL risk to require approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-3",
        decision: "EXECUTE",
        reasoning: "Critical risk",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "EXECUTE");
      assert.strictEqual(route.requiresApproval, true);
    });

    it("routes ASK_USER decision without approval check", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-4",
        decision: "ASK_USER",
        reasoning: "Need user input",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "ASK_USER");
    });

    it("routes BLOCKED decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-5",
        decision: "BLOCKED",
        reasoning: "Cannot proceed",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "BLOCKED");
    });

    it("routes RESEARCH decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-6",
        decision: "RESEARCH",
        reasoning: "Need more info",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "RESEARCH");
    });

    it("routes MORE_EVIDENCE decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-7",
        decision: "MORE_EVIDENCE",
        reasoning: "Insufficient evidence",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "MORE_EVIDENCE");
    });

    it("routes REVISE decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-8",
        decision: "REVISE",
        reasoning: "Plan needs revision",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "REVISE");
    });
  });

  describe("Approval requirement detection", () => {
    it("requires approval for HIGH risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-9",
        decision: "EXECUTE",
        reasoning: "High risk",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      assert.strictEqual(requiresCouncilApproval(decision), true);
    });

    it("requires approval for CRITICAL risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-10",
        decision: "EXECUTE",
        reasoning: "Critical",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      assert.strictEqual(requiresCouncilApproval(decision), true);
    });

    it("does not require approval for LOW risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-11",
        decision: "EXECUTE",
        reasoning: "Low risk",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      assert.strictEqual(requiresCouncilApproval(decision), false);
    });

    it("does not require approval for non-EXECUTE decisions", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-12",
        decision: "ASK_USER",
        reasoning: "User input",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      assert.strictEqual(requiresCouncilApproval(decision), false);
    });
  });

  describe("ExecutionCandidate payload creation", () => {
    it("creates structured payload for EXECUTE decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-13",
        decision: "EXECUTE",
        reasoning: "Safe plan",
        executionProposal: "run_task('foo')",
        riskLevel: "MEDIUM",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId: "cycle-13",
        decision,
        goal: "Complete task foo",
      });

      assert.strictEqual(payload.cycleId, "cycle-13");
      assert.strictEqual(payload.decision, "EXECUTE");
      assert.strictEqual(payload.reasoning, "Safe plan");
      assert.strictEqual(payload.proposal, "run_task('foo')");
      assert.strictEqual(payload.riskLevel, "MEDIUM");
      assert.strictEqual(payload.requiresApproval, false);
      assert.strictEqual(payload.goal, "Complete task foo");
    });

    it("defaults riskLevel to MEDIUM if not provided", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-14",
        decision: "EXECUTE",
        reasoning: "Plan",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId: "cycle-14",
        decision,
        goal: "Task",
      });

      assert.strictEqual(payload.riskLevel, "MEDIUM");
    });

    it("sets requiresApproval based on HIGH risk", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-15",
        decision: "EXECUTE",
        reasoning: "High risk",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId: "cycle-15",
        decision,
        goal: "Risky task",
      });

      assert.strictEqual(payload.requiresApproval, true);
    });
  });

  describe("Event identity mapping", () => {
    it("creates stable identity key for event", () => {
      const identity1 = mapCouncilEventIdentity({
        cycleId: "cycle-16",
        eventType: "planner_started",
      });

      const identity2 = mapCouncilEventIdentity({
        cycleId: "cycle-16",
        eventType: "planner_started",
      });

      assert.strictEqual(identity1.key, identity2.key);
      assert.strictEqual(identity1.key, "cycle-16:planner_started");
    });

    it("formats event name without brain", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-17",
        eventType: "planner_started",
      });

      assert.strictEqual(identity.displayName, "Planner started");
    });

    it("formats event name with brain identifier", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-18",
        eventType: "critic_completed",
        brain: "CRITIC",
      });

      assert.strictEqual(identity.displayName, "Critic completed (CRITIC)");
    });

    it("handles unknown event types", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-19",
        eventType: "custom_event",
      });

      assert.strictEqual(identity.displayName, "custom_event");
    });

    it("includes brain in unknown event type display", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-20",
        eventType: "custom_event",
        brain: "PLANNER",
      });

      assert.strictEqual(identity.displayName, "custom_event (PLANNER)");
    });
  });

  describe("Multiple decision types coverage", () => {
    it("EXECUTE with MEDIUM risk does not require approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-21",
        decision: "EXECUTE",
        reasoning: "Medium risk",
        riskLevel: "MEDIUM",
        requiresApproval: false,
      };

      assert.strictEqual(requiresCouncilApproval(decision), false);
    });

    it("maintains decision payload structure across all fields", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-22",
        decision: "EXECUTE",
        reasoning: "Complete reasoning",
        executionProposal: "execute_with_details()",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId: "cycle-22",
        decision,
        goal: "Full goal statement",
      });

      // All fields present
      assert.ok(payload.cycleId);
      assert.ok(payload.decision);
      assert.ok(payload.reasoning);
      assert.ok(payload.proposal);
      assert.ok(payload.riskLevel);
      assert.ok(typeof payload.requiresApproval === "boolean");
      assert.ok(payload.goal);
    });
  });
});
