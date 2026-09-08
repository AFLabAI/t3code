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
 * Relay ExecutionCandidate through OpenCode to Ox executor.
 * OpenCode does NOT execute - it relays to Ox.
 * Ox is the sole execution authority.
 */
export const relayToOxViaOpenCode = (request: ExecutionRequest): ExecutionResult => {
  // This is a placeholder that relays to local Ox (file creation sandbox).
  // In production, this would:
  // 1. Connect to OpenCode server
  // 2. Send ExecutionCandidate to OpenCode
  // 3. OpenCode relays to Ox
  // 4. Ox executes (file creation, code execution, etc.)
  // 5. Ox returns ExecutionResult to OpenCode
  // 6. OpenCode relays result back

  const match = request.proposal.match(
    /[Cc]reate\s+file\s+(\S+)\s+with\s+(?:exact\s+)?content:\s*(.+)$/s,
  );
  if (!match || !match[1] || !match[2]) {
    return { success: false, error: "Could not parse file creation intent from proposal" };
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
      error: `Ox execution failed: ${String(e)}`,
    };
  }
};
