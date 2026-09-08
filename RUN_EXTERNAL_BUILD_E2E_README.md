# T3 Desktop External Build + E2E Test Automation

**Script:** `RUN_EXTERNAL_BUILD_E2E.ps1`
**Target:** External high-RAM machine (≥12GB RAM)
**Phases:** 2, 3, 4 from EXTERNAL_BUILD_HANDOFF.md

---

## WHAT THIS SCRIPT DOES

Automates Phases 2-4:

1. **Phase 2: Build**
   - Validates ≥12GB RAM available
   - Verifies branch = council-v1-validation
   - Verifies commit = 8067c58a9 (CRITICAL)
   - Cleans old artifacts
   - Runs: `npm run dist:desktop:win:x64`
   - Verifies executable created

2. **Phase 3: Launch & Verify UI**
   - Launches newly built T3 executable
   - Waits for UI to load
   - Confirms OpenCode provider visible

3. **Phase 4: Real E2E Test**
   - Guides manual test submission from T3 UI
   - Creates proof file via real OpenCode→Council→Ox path
   - Verifies single execution (no duplicate)

---

## REQUIREMENTS

**Machine:**

- Windows 10 or Windows 11
- ≥12GB RAM **available** (CRITICAL)
- Multi-core CPU recommended

**Software:**

- PowerShell 5.1+ (built into Windows 10+)
- Node.js v24.13.1
- pnpm v11.10.0
- Git

**Repository:**

- council-v1-validation branch
- Commit 8067c58a9

---

## HOW TO RUN

### Step 1: Prepare External Machine

```powershell
# Open PowerShell as Administrator (not required but recommended)

# Clone repository if not already present
git clone https://github.com/pingdotgg/t3code.git
cd t3code

# OR if already cloned, fetch latest
git fetch origin

# Checkout correct branch
git checkout council-v1-validation

# Verify you have the right commit
git log -1 --oneline
# Should show: 8067c58a9 fix: remove duplicate execution from T3, make OpenCode pure transport
```

### Step 2: Copy Script

Copy this file to the external machine:

- Source: `RUN_EXTERNAL_BUILD_E2E.ps1`
- Destination: `C:\Users\<USER>\t3code-council-v1\` or your clone path

### Step 3: Run Script

```powershell
# Navigate to repository
cd C:\Users\<USER>\t3code-council-v1

# Run script
.\RUN_EXTERNAL_BUILD_E2E.ps1
```

**Important:** Do NOT run on low-RAM machine. Script will detect and abort if <12GB.

---

## SCRIPT FLOW

```
START
  ↓
Phase 2: Validate Environment
  ├─ Check ≥12GB RAM ─ ABORT if <12GB
  ├─ Check Node.js/pnpm/Git
  ├─ Verify branch = council-v1-validation
  ├─ Verify commit = 8067c58a9
  ├─ Check working tree clean
  └─ Status: PASS / FAIL
  ↓
Phase 2: Build T3 Desktop
  ├─ Clean old node_modules
  ├─ Run: npm run dist:desktop:win:x64
  ├─ Wait for completion (~15-20 min)
  └─ Status: PASS / FAIL
  ↓
Phase 3: Verify Artifact
  ├─ Check executable exists (release/T3-Code-*.exe)
  ├─ Record path, size, timestamp
  └─ Status: PASS / FAIL
  ↓
Phase 3: Launch T3 UI
  ├─ Start T3 executable
  ├─ Wait 10 seconds for UI load
  ├─ Verify process still running
  └─ Status: PASS / FAIL
  ↓
Phase 3: Verify OpenCode in UI
  ├─ Confirm T3 window visible
  ├─ Require manual: Open Composer → see "OpenCode" in provider dropdown
  └─ Status: PASS / BLOCKED
  ↓
Phase 4: Real T3 UI E2E Test
  ├─ Manual: Submit goal from ACTUAL T3 UI
  ├─ T3_UI_SUBMISSION = PASS (goal submitted from T3 UI confirmed)
  ├─ Wait for execution
  ├─ Check proof file: C:\Users\USER\PIS\ox_sandbox\T3_E2E_TEST.txt
  ├─ OX_PROOF_FILE = PASS (Ox executed and created proof file)
  ├─ Verify result displayed in T3 UI
  └─ T3_REAL_E2E = PASS (full round-trip confirmed)
      OR T3_REAL_E2E = BLOCKED (if proof file not created)
  ↓
FINAL REPORT
  ├─ Summary of all phases
  ├─ Build artifact path
  ├─ Certification status (distinguishes OX_PROOF from T3_REAL_E2E)
  └─ END
```

---

## OUTPUT INTERPRETATION

### Certification Rule: Critical Distinction

**OX_PROOF_FILE = PASS**

- **Means:** Proof file was created
- **Proves:** Ox executor ran (WorkerIntegration → RealOxExecutor)
- **NOT sufficient for:** T3_REAL_E2E

**T3_REAL_E2E = PASS**

- **Means:** Full round-trip verified from actual T3 UI
- **Requires ALL:**
  1. Goal submitted from actual T3 Desktop UI (not API, not script)
  2. OpenCode provider selected in T3 UI
  3. Council received the UI-originated request
  4. Council → WorkerIntegration → RealOxExecutor executed exactly once
  5. ExecutionResult returned through OpenCode transport
  6. T3 UI received and displayed the result
  7. Proof file created as side effect of Ox execution

### Success Indicators

```
✓ ENVIRONMENT = PASS
✓ GIT_COMMIT = PASS
✓ BUILD = PASS
✓ EXECUTABLE = PASS
✓ LAUNCH = PASS
✓ OPENCODE_UI = PASS
✓ T3_UI_SUBMISSION = PASS
✓ OX_PROOF_FILE = PASS
✓ T3_REAL_E2E = PASS

OVERALL: SUCCESS
```

**Means:** Build works, T3 UI loads, OpenCode visible, real T3 UI submitted goal, Ox executed, result returned to T3 UI, proof file created.

### Build Failed

```
✗ BUILD = FAIL
```

**Likely causes:**

- Insufficient RAM (should have been caught earlier)
- Dependency download timeout
- Compilation error

**Action:** Check build output in script, retry with fresh clone or verify network connectivity.

### Blocked at UI

```
✓ BUILD = PASS
✓ EXECUTABLE = PASS
✗ LAUNCH = FAIL
```

**Means:** Executable created but won't launch.

**Action:** Try launching manually, check for error dialogs, verify build completed fully.

### Blocked at E2E (No Proof File)

```
✓ OPENCODE_UI = PASS
✓ T3_UI_SUBMISSION = PASS
✗ OX_PROOF_FILE = BLOCKED/FAIL
✗ T3_REAL_E2E = BLOCKED
```

**Means:** UI loaded, goal submitted, but proof file not created (Ox didn't execute).

**Possible causes:**

- Council API not running on localhost:8000
- Goal not properly relayed to Council
- Council decision made but execution failed
- Goal still processing (wait longer)

**Action:**

1. Check C:\Users\USER\PIS\ox_sandbox for any recent files
2. Verify Council API is running: `curl http://localhost:8000/health`
3. Check Council logs for the goal submission
4. Retry with longer wait time (script defaults to 45s)

### Success with Proof File (Ox Executed)

```
✓ T3_UI_SUBMISSION = PASS
✓ OX_PROOF_FILE = PASS
✓ T3_REAL_E2E = PASS
```

**Means:** Full T3 UI E2E round-trip successful.

**Verification:**

1. Goal originated from actual T3 UI Composer ✓
2. OpenCode transported to Council ✓
3. Council made decision ✓
4. WorkerIntegration → RealOxExecutor ran ✓
5. Result returned to T3 UI ✓
6. Proof file created (evidence of Ox execution) ✓

---

## MANUAL STEPS DURING AUTOMATION

Script will pause and guide you through:

1. **OpenCode UI Verification** (Phase 3)
   - Look at T3 window
   - Open Composer
   - Verify "OpenCode" appears in model/provider dropdown
   - Confirm or abort

2. **E2E Test Submission** (Phase 4)
   - Script displays exact goal text to submit
   - You enter it in T3 UI
   - You click Submit
   - Script waits for proof file

---

## CRITICAL RULES

**DO:**

- ✓ Use commit 8067c58a9 (verified by script)
- ✓ Run on ≥12GB RAM machine (verified by script)
- ✓ Use real T3 UI for E2E test
- ✓ Submit goal from Composer in actual T3 window
- ✓ Let script verify proof file was created

**DO NOT:**

- ✗ Run on <12GB RAM machine
- ✗ Modify script to skip validations
- ✗ Submit goal via API and call it E2E
- ✗ Manually create proof files
- ✗ Use old executable (0.0.33, 0.0.36)
- ✗ Use commit 3e4f6a56e

---

## EXPECTED BUILD TIME

- Environment validation: ~30 seconds
- Build phase: 15-20 minutes
- UI launch & verification: 10-15 seconds
- E2E test & proof verification: 1-2 minutes

**Total:** ~20-25 minutes

---

## TROUBLESHOOTING

| Issue                                | Check                               | Fix                                         |
| ------------------------------------ | ----------------------------------- | ------------------------------------------- |
| "Insufficient total RAM"             | `systeminfo` RAM entry              | Only run on ≥12GB machine                   |
| "Repository path not found"          | Clone directory                     | Verify repo path in script                  |
| "Node.js not found"                  | `node --version`                    | Install Node.js v24.13.1                    |
| "Build failed (exit code 255)"       | Build logs                          | Retry with clean clone, check network       |
| "Build stalls at dependency install" | pnpm output                         | Check internet connection, retry            |
| "Executable not found"               | `dir release/`                      | Build may have failed silently, check logs  |
| "T3 window doesn't appear"           | Task Manager                        | Check for crashes, run manually for error   |
| "OpenCode not in provider list"      | T3 Composer dropdown                | Build from wrong commit, rebuild            |
| "Proof file not created"             | `dir C:\Users\USER\PIS\ox_sandbox\` | Council API not running, goal not submitted |

---

## AFTER SCRIPT COMPLETES

### If OVERALL: SUCCESS

1. Preserve executable: `release/T3-Code-*.exe`
2. Preserve proof file: `C:\Users\USER\PIS\ox_sandbox\T3_E2E_TEST.txt`
3. Note build date/time and file size
4. Archive for certification

### If OVERALL: BLOCKED or FAILED

1. Check script output for exact failure point
2. Fix the issue (e.g., start Council API, use correct commit)
3. Optionally re-run script from that point
4. Or perform manual steps guided by EXTERNAL_BUILD_HANDOFF.md

---

## SCRIPT LIMITATIONS

**Automated:**

- Environment validation
- Git verification
- Build execution
- Artifact verification
- Process launching
- Proof file checking

**Manual (requires human):**

- Verifying OpenCode appears in UI (GUI inspection required)
- Submitting test goal from T3 UI (cannot automate GUI interaction)
- Monitoring execution in T3 window

This is intentional: ensures **real T3 UI** initiates the test, not simulated submission.

---

## ARCHITECTURE VERIFICATION

Script embeds these checks:

1. **Branch:** Must be `council-v1-validation`
2. **Commit:** Must be exactly `8067c58a9`
3. **Execution Path:** Verified by source code (OpenCodeBridge has no fs.writeFileSync, CouncilCommandReactor has no re-execution)
4. **Single Path:** Only Council API → WorkerIntegration → RealOxExecutor is available

---

## NEXT STEPS

After successful run (OVERALL: SUCCESS):

1. Report final status to main coordination
2. Save build artifact for deployment
3. Document any deviations from expected behavior
4. Archive proof files for audit trail
5. Proceed to Phase 5 (Full E2E certification) if required

---

**Script Version:** 1.0
**Date:** 2026-09-08
**Commit:** 8067c58a9
**Target Machine:** External ≥12GB RAM, Windows
**Do Not Run On:** Low-RAM machines (<12GB available)
