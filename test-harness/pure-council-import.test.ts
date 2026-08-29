import { describe, it } from "node:test";
import assert from "node:assert";
import {
  routeCouncilDecision,
  requiresCouncilApproval,
  createExecutionCandidatePayload,
  mapCouncilEventIdentity,
} from "../apps/server/src/council/CouncilDecisionRouter.ts";

describe("Pure Council module imports", () => {
  it("imports CouncilDecisionRouter without dependencies", () => {
    assert.ok(routeCouncilDecision);
    assert.ok(requiresCouncilApproval);
    assert.ok(createExecutionCandidatePayload);
    assert.ok(mapCouncilEventIdentity);
  });

  it("functions are callable", () => {
    const decision = {
      cycleId: "test",
      decision: "EXECUTE" as const,
      reasoning: "test",
      requiresApproval: false,
    };

    const route = routeCouncilDecision(decision);
    assert.ok(route);
    assert.strictEqual(route.type, "EXECUTE");
  });
});
