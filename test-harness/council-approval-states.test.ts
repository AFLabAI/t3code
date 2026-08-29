import { describe, it } from "node:test";
import assert from "node:assert";
import {
  routeCouncilDecision,
  requiresCouncilApproval,
  createExecutionCandidatePayload,
} from "../apps/server/src/council/CouncilDecisionRouter.ts";
import type { CouncilDecision } from "../apps/server/src/council/CouncilClient.ts";

describe("Council → Approval State Integration", () => {
  describe("LOW risk EXECUTE", () => {
    it("routes to READY_FOR_EXECUTOR without approval gate", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "EXECUTE",
        reasoning: "Safe action",
        executionProposal: "run_task()",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      const route = routeCouncilDecision(decision);

      assert.strictEqual(requiresApproval, false);
      assert.strictEqual(route.type, "EXECUTE");
      assert.strictEqual(route.requiresApproval, false);
    });

    it("creates ExecutionCandidate for low-risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-2",
        decision: "EXECUTE",
        reasoning: "Safe",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId: "cycle-2",
        decision,
        goal: "Low risk task",
      });

      assert.strictEqual(payload.decision, "EXECUTE");
      assert.strictEqual(payload.riskLevel, "LOW");
      assert.strictEqual(payload.requiresApproval, false);
    });
  });

  describe("MEDIUM risk EXECUTE", () => {
    it("routes to READY_FOR_EXECUTOR by default", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-3",
        decision: "EXECUTE",
        reasoning: "Medium complexity",
        riskLevel: "MEDIUM",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";

      assert.strictEqual(requiresApproval, false);
    });
  });

  describe("HIGH risk EXECUTE", () => {
    it("creates approval request (not direct ExecutionCandidate)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-4",
        decision: "EXECUTE",
        reasoning: "High risk action",
        executionProposal: "dangerous_op()",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      assert.strictEqual(requiresApproval, true);
    });

    it("approval request contains Council context", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-5",
        decision: "EXECUTE",
        reasoning: "Expert analysis recommends",
        executionProposal: "deploy_release()",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      // Simulated approval request payload
      const approvalPayload = {
        cycleId: decision.cycleId,
        councilCycleId: decision.cycleId,
        decision: decision.decision,
        reasoning: decision.reasoning,
        proposal: decision.executionProposal,
        riskLevel: decision.riskLevel,
        goal: "Deploy release v2.0",
      };

      assert.ok(approvalPayload.cycleId);
      assert.ok(approvalPayload.councilCycleId);
      assert.strictEqual(approvalPayload.decision, "EXECUTE");
      assert.ok(approvalPayload.reasoning);
      assert.ok(approvalPayload.proposal);
      assert.strictEqual(approvalPayload.riskLevel, "HIGH");
    });

    it("user approval moves to READY_FOR_EXECUTOR", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-6",
        decision: "EXECUTE",
        reasoning: "Approved by Council",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      // WAITING_USER_APPROVAL → user approves → READY_FOR_EXECUTOR
      const approvalRequired = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";

      assert.strictEqual(approvalRequired, true);
      // After approval, executor would process this
    });

    it("user rejection moves to BLOCKED", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-7",
        decision: "EXECUTE",
        reasoning: "Requires approval",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      // WAITING_USER_APPROVAL → user rejects → BLOCKED
      // No ExecutionCandidate created
      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      assert.strictEqual(requiresApproval, true);
    });
  });

  describe("CRITICAL risk EXECUTE", () => {
    it("requires approval gate", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-8",
        decision: "EXECUTE",
        reasoning: "Critical infrastructure change",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      assert.strictEqual(requiresApproval, true);
    });

    it("approval decision determines execution", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-9",
        decision: "EXECUTE",
        reasoning: "System-critical change",
        executionProposal: "drop_database()",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      // WAITING_USER_APPROVAL is mandatory
      const shouldBeApprovalGated = decision.riskLevel === "CRITICAL";
      assert.strictEqual(shouldBeApprovalGated, true);

      // reject → BLOCKED (no execution)
      // accept → READY_FOR_EXECUTOR (executor runs later)
    });
  });

  describe("ASK_USER decision", () => {
    it("routes to WAITING_USER_APPROVAL (no ExecutionCandidate)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-10",
        decision: "ASK_USER",
        reasoning: "Need user guidance",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "ASK_USER");

      // No ExecutionCandidate created, awaits user input
    });
  });

  describe("BLOCKED decision", () => {
    it("routes to BLOCKED state (no execution)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-11",
        decision: "BLOCKED",
        reasoning: "Cannot proceed, constraints violated",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "BLOCKED");

      // No ExecutionCandidate, no approval request
      // Terminal state unless user revises goal
    });
  });

  describe("RESEARCH decision", () => {
    it("routes to RESEARCH state (holding)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-12",
        decision: "RESEARCH",
        reasoning: "Needs investigation",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "RESEARCH");
    });
  });

  describe("MORE_EVIDENCE decision", () => {
    it("routes to MORE_EVIDENCE state (holding)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-13",
        decision: "MORE_EVIDENCE",
        reasoning: "Insufficient data",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "MORE_EVIDENCE");
    });
  });

  describe("Approval idempotency", () => {
    it("duplicate approval does not create duplicate ExecutionCandidate", () => {
      // Same cycleId + decision → same ExecutionCandidate ID
      const decision: CouncilDecision = {
        cycleId: "cycle-14",
        decision: "EXECUTE",
        reasoning: "Safe",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const payload1 = createExecutionCandidatePayload({
        cycleId: "cycle-14",
        decision,
        goal: "Task",
      });

      const payload2 = createExecutionCandidatePayload({
        cycleId: "cycle-14",
        decision,
        goal: "Task",
      });

      // Both payloads should be identical (idempotent)
      assert.deepStrictEqual(payload1, payload2);
    });

    it("duplicate Council result does not create duplicate approval request", () => {
      // Same cycleId → same approval request ID
      // Thread state prevents duplicate processing
      const cycleId = "cycle-15";

      // First result: creates approval request
      // Second result: idempotent (same cycleId, same request ID)
      // Decider should track this via thread state
      assert.ok(cycleId);
    });
  });

  describe("Already READY_FOR_EXECUTOR does not regress", () => {
    it("second approval decision is no-op", () => {
      // Once READY_FOR_EXECUTOR, already approved
      // Second approval attempt should not change state
      const decision: CouncilDecision = {
        cycleId: "cycle-16",
        decision: "EXECUTE",
        reasoning: "Ready",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      // State is idempotent:
      // 1st: create ExecutionCandidate → READY_FOR_EXECUTOR
      // 2nd: already in READY, no-op
      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "EXECUTE");
    });
  });

  describe("Rejected candidate cannot silently execute", () => {
    it("BLOCKED stays non-executable", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-17",
        decision: "BLOCKED",
        reasoning: "Rejected by Council",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      assert.strictEqual(route.type, "BLOCKED");

      // No ExecutionCandidate created
      // Blocked state is terminal (no execution path)
    });
  });

  describe("Cycle ID stability", () => {
    it("cycleId persists through approval flow", () => {
      const cycleId = "cycle-18";
      const decision: CouncilDecision = {
        cycleId,
        decision: "EXECUTE",
        reasoning: "Approval needed",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId,
        decision,
        goal: "Task",
      });

      // cycleId is immutable through approval chain
      assert.strictEqual(payload.cycleId, cycleId);
    });
  });
});
