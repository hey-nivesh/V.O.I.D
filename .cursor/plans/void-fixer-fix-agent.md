# VOID-Fixer + fix-agent (updated protocol handover)

## Goal

Implement the VOID-Fixer pipeline **only under [fix-agent](fix-agent)**, driven by a **structured RCA / handover JSON** that includes Gatekeeper, Sherlock, Void-Fixer instructions, and HyperContext. Wire the agent so it can consume this payload and connect to the MCP server’s ticket lifecycle **without** merging branches (manifest-only exit).

## Canonical handover shape (v1.0.0)

The runtime input is a single JSON object with these top-level sections (matches the provided example):

- **`metadata`** — `protocol_version`, `timestamp`, `ticket_id`, `priority`
- **`gatekeeper_context`** — `session_id`, `jit_token`, `expiry_unix`, **`sandbox_path`** (authoritative working copy for git + tools)
- **`sherlock_diagnosis`** — `issue_summary`, `patient_zero` (`file`, `line_number`, `code_snippet`), `failure_chain[]`, **`relevant_paths[]`**
- **`void_fixer_instructions`** — `target_branch_base`, `mode`, `self_healing_attempts`, **`verification_command`**, `styling_rules`
- **`hyper_context_payload`** — optional app/runtime hints (`redux_state_snapshot`, `last_logcat_lines`, etc.)

### TypeScript modules (fix-agent)

| Module | Purpose |
|--------|---------|
| `fix-agent/src/void/types.ts` | Zod or TS interfaces for the **full handover** plus **`FixManifest`** output. Export a single **`RCAHandover`** (or `VoidProtocolHandover`) that mirrors this JSON. |
| `fix-agent/src/void/pathScope.ts` | Resolve paths under `gatekeeper_context.sandbox_path`; reject escapes (`..`). |
| `fix-agent/src/void/gitVoid.ts` | `git sparse-checkout` from `sherlock_diagnosis.relevant_paths`; checkout/create branch from `void_fixer_instructions.target_branch_base`; create `void-fix/{ticketId}-{timestamp}`; commit; **no merge**. |
| `fix-agent/src/void/exitHandler.ts` | Write **`fix_manifest.json`** at repo root (or configurable path under sandbox): branch name, summary, **`test_status`**, files touched, ticket id, optional pointer to verification command result. |
| `fix-agent/src/void/voidFixer.ts` | **`startVoidFix(handover: RCAHandover)`**: orchestrate sparse checkout → branch → fix loop → verification → manifest. |

## Behavioral mapping (JSON → actions)

1. **`targetRepo`** (internal) = `gatekeeper_context.sandbox_path`, normalized for the current OS (Windows paths supported).
2. **Sparse checkout** uses `sherlock_diagnosis.relevant_paths` (repo-relative). If empty, log and skip sparse or fall back to full tree (same as prior plan).
3. **Branch base** = `void_fixer_instructions.target_branch_base` (e.g. `main`) before creating `void-fix/{ticketId}-{timestamp}`.
4. **Self-healing / reflexion** = up to `void_fixer_instructions.self_healing_attempts` iterations of: apply fix strategy (placeholder or `VOID_FIX_COMMAND` / future Cline) → lint/style per `styling_rules` (best-effort) → run **`void_fixer_instructions.verification_command`** in `sandbox_path` → stop on success or max attempts.
5. **`test_status`** on the manifest = boolean success of `verification_command` on the **last** attempt (or `false` if never passed).
6. **PII / security**: do not log `jit_token` in plain info logs; optional redaction helper for Gatekeeper fields in debug output.
7. **HyperContext** is persisted on the manifest or summary only as **non-sensitive** summaries if needed (e.g. omit raw redux snapshot from logs by default).

## Fix manifest (`fix_manifest.json`)

Minimum fields (extend prior plan):

- `branch_name`, `ticket_id` (from `metadata.ticket_id`), `summary` (Sherlock `issue_summary` + short outcome), `test_status` (boolean), `files_modified`, `created_at`, `verification_command` (echo from instructions), `attempts_used` (≤ `self_healing_attempts`)

No merge; no PR creation inside VOID-Fixer.

## Connections (MCP + agent)

1. **Today (demo / local)**  
   - `VOID_RCA_JSON_PATH` pointing to a file with the handover JSON, **or** embed handover in `processTicket` for tests.  
   - `ticket_id` in SSE events must align with `metadata.ticket_id` when both exist (map event payload → handover or merge).

2. **Near-term API**  
   - Store the full handover on the ticket (e.g. `user_context.rca` or `tickets.rca_json` column) when Gatekeeper/Sherlock publish results; **GET `/api/tickets/:id`** returns it so **fix-agent** builds `RCAHandover` without a separate file.

3. **submit_fix** ([SubmitFixRequest](mcp-server/src/types/index.ts))  
   - Map: `summary` ← manifest + Sherlock summary; `files_modified`, `diff` from git; `test_results.status` ← `PASS`/`FAIL` from verification; `sandbox_preview_url` unchanged / optional.

4. **Cline headless (later)**  
   - Same `RCAHandover` JSON passed as stdin or file path to Cline; no duplicate type definitions outside fix-agent until a shared package is introduced.

## Out of scope for this package

- Implementing Gatekeeper JIT or Sherlock engines (only **consume** their JSON).
- Modifying `cline` extension `Cline.ts` unless that tree is fully vendored later.

## Verification checklist

- Handover sample (VOID-7892-ALPHA) parses and drives `sandbox_path`, `relevant_paths`, `target_branch_base`, `verification_command`.
- Git operations run with `cwd` = sandbox only; paths validated.
- Manifest written; MCP `submit_fix` receives consistent fields.

## Implementation todos

1. Define full **`RCAHandover`** + **`FixManifest`** in `fix-agent/src/void/types.ts` (match protocol v1.0.0).
2. Implement **`pathScope`**, **`gitVoid`**, **`exitHandler`**, **`voidFixer`** with new field wiring.
3. Refactor **`fix-agent` entry** to load handover (file/env/API placeholder), claim ticket, run `startVoidFix`, then `submit_fix`.
4. Document env vars: `VOID_TARGET_REPO` override (optional if always from handover), `VOID_RCA_JSON_PATH`, `VOID_FIX_COMMAND`, optional `VOID_FIX_COMMAND` self-healing hook.

---

*Supersedes the earlier void-fixer plan that only had minimal `RCAHandover` fields; this version is authoritative for Gatekeeper + Sherlock + Void-Fixer instructions + HyperContext.*
