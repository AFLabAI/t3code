import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert";
import {
  routeCouncilDecision,
  requiresCouncilApproval,
  createExecutionCandidatePayload,
  mapCouncilEventIdentity,
} from "../apps/server/src/council/CouncilDecisionRouter.ts";
import type { CouncilDecision } from "../apps/server/src/council/CouncilClient.ts";

NodeTest.describe("CouncilDecisionRouter - Pure functions", () => {
  NodeTest.describe("Decision routing", () => {
    NodeTest.it("routes EXECUTE decision with LOW risk to execute without approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "EXECUTE",
        reasoning: "Safe to execute",
        executionProposal: "run task",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "EXECUTE");
      NodeAssert.default.strictEqual(route.requiresApproval, false);
    });

    NodeTest.it("routes EXECUTE decision with HIGH risk to require approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-2",
        decision: "EXECUTE",
        reasoning: "High risk",
        executionProposal: "run sensitive",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "EXECUTE");
      NodeAssert.default.strictEqual(route.requiresApproval, true);
    });

    NodeTest.it("routes EXECUTE decision with CRITICAL risk to require approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-3",
        decision: "EXECUTE",
        reasoning: "Critical risk",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "EXECUTE");
      NodeAssert.default.strictEqual(route.requiresApproval, true);
    });

    NodeTest.it("routes ASK_USER decision without approval check", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-4",
        decision: "ASK_USER",
        reasoning: "Need user input",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "ASK_USER");
    });

    NodeTest.it("routes BLOCKED decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-5",
        decision: "BLOCKED",
        reasoning: "Cannot proceed",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "BLOCKED");
    });

    NodeTest.it("routes RESEARCH decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-6",
        decision: "RESEARCH",
        reasoning: "Need more info",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "RESEARCH");
    });

    NodeTest.it("routes MORE_EVIDENCE decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-7",
        decision: "MORE_EVIDENCE",
        reasoning: "Insufficient evidence",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "MORE_EVIDENCE");
    });

    NodeTest.it("routes REVISE decision", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-8",
        decision: "REVISE",
        reasoning: "Plan needs revision",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "REVISE");
    });
  });

  NodeTest.describe("Approval requirement detection", () => {
    NodeTest.it("requires approval for HIGH risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-9",
        decision: "EXECUTE",
        reasoning: "High risk",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      NodeAssert.default.strictEqual(requiresCouncilApproval(decision), true);
    });

    NodeTest.it("requires approval for CRITICAL risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-10",
        decision: "EXECUTE",
        reasoning: "Critical",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      NodeAssert.default.strictEqual(requiresCouncilApproval(decision), true);
    });

    NodeTest.it("does not require approval for LOW risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-11",
        decision: "EXECUTE",
        reasoning: "Low risk",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      NodeAssert.default.strictEqual(requiresCouncilApproval(decision), false);
    });

    NodeTest.it("does not require approval for non-EXECUTE decisions", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-12",
        decision: "ASK_USER",
        reasoning: "User input",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      NodeAssert.default.strictEqual(requiresCouncilApproval(decision), false);
    });
  });

  NodeTest.describe("ExecutionCandidate payload creation", () => {
    NodeTest.it("creates structured payload for EXECUTE decision", () => {
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

      NodeAssert.default.strictEqual(payload.cycleId, "cycle-13");
      NodeAssert.default.strictEqual(payload.decision, "EXECUTE");
      NodeAssert.default.strictEqual(payload.reasoning, "Safe plan");
      NodeAssert.default.strictEqual(payload.proposal, "run_task('foo')");
      NodeAssert.default.strictEqual(payload.riskLevel, "MEDIUM");
      NodeAssert.default.strictEqual(payload.requiresApproval, false);
      NodeAssert.default.strictEqual(payload.goal, "Complete task foo");
    });

    NodeTest.it("defaults riskLevel to MEDIUM if not provided", () => {
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

      NodeAssert.default.strictEqual(payload.riskLevel, "MEDIUM");
    });

    NodeTest.it("sets requiresApproval based on HIGH risk", () => {
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

      NodeAssert.default.strictEqual(payload.requiresApproval, true);
    });
  });

  NodeTest.describe("Event identity mapping", () => {
    NodeTest.it("creates stable identity key for event", () => {
      const identity1 = mapCouncilEventIdentity({
        cycleId: "cycle-16",
        eventType: "planner_started",
      });

      const identity2 = mapCouncilEventIdentity({
        cycleId: "cycle-16",
        eventType: "planner_started",
      });

      NodeAssert.default.strictEqual(identity1.key, identity2.key);
      NodeAssert.default.strictEqual(identity1.key, "cycle-16:planner_started");
    });

    NodeTest.it("formats event name without brain", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-17",
        eventType: "planner_started",
      });

      NodeAssert.default.strictEqual(identity.displayName, "Planner started");
    });

    NodeTest.it("formats event name with brain identifier", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-18",
        eventType: "critic_completed",
        brain: "CRITIC",
      });

      NodeAssert.default.strictEqual(identity.displayName, "Critic completed (CRITIC)");
    });

    NodeTest.it("handles unknown event types", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-19",
        eventType: "custom_event",
      });

      NodeAssert.default.strictEqual(identity.displayName, "custom_event");
    });

    NodeTest.it("includes brain in unknown event type display", () => {
      const identity = mapCouncilEventIdentity({
        cycleId: "cycle-20",
        eventType: "custom_event",
        brain: "PLANNER",
      });

      NodeAssert.default.strictEqual(identity.displayName, "custom_event (PLANNER)");
    });
  });

  NodeTest.describe("Multiple decision types coverage", () => {
    NodeTest.it("EXECUTE with MEDIUM risk does not require approval", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-21",
        decision: "EXECUTE",
        reasoning: "Medium risk",
        riskLevel: "MEDIUM",
        requiresApproval: false,
      };

      NodeAssert.default.strictEqual(requiresCouncilApproval(decision), false);
    });

    NodeTest.it("maintains decision payload structure across all fields", () => {
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
      NodeAssert.default.ok(payload.cycleId);
      NodeAssert.default.ok(payload.decision);
      NodeAssert.default.ok(payload.reasoning);
      NodeAssert.default.ok(payload.proposal);
      NodeAssert.default.ok(payload.riskLevel);
      NodeAssert.default.ok(typeof payload.requiresApproval === "boolean");
      NodeAssert.default.ok(payload.goal);
    });
  });
});
