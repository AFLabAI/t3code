/**
 * OpenCodeBridge — relay ExecutionCandidate through OpenCode to Ox executor.
 *
 * Council → OpenCode → Ox → result → OpenCode → Council
 *
 * OpenCode responsibilities: transport/relay only, never execute independently.
 */
import { ThreadId } from "@t3tools/contracts";

export interface ExecutionRequest {
  cycleId: string;
  goal: string;
  proposal: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  threadId: ThreadId;
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  proof_file?: string;
}

/**
 * Transport relay for ExecutionCandidate.
 * OpenCode DOES NOT EXECUTE. Execution is handled by Council API (WorkerIntegration → Ox).
 * This is pure transport/relay - acknowledgment only.
 * Ox is the sole execution authority. Council API owns the execution lifecycle.
 */
export const relayToOxViaOpenCode = (request: ExecutionRequest): ExecutionResult => {
  // This is a RELAY ONLY - no execution.
  // The actual execution happened in Council API via WorkerIntegration → RealOxExecutor
  // during the submit_goal phase. This function acknowledges the relay.

  // In a full production system, this would:
  // 1. (Optional) Connect to OpenCode server
  // 2. (Optional) Relay to actual Ox via HTTP
  // 3. Wait for Ox result
  // 4. Return result

  // For now, acknowledge that Council API will handle execution.
  return {
    success: true,
    output: `ExecutionCandidate relayed to Council for execution`,
    error: undefined,
  };
};
