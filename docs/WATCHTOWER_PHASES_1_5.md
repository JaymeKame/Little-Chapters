# Watchtower V1: phases 1–5

This implementation intentionally stops after capture, normalization, attempt segmentation,
failure-evidence extraction, and attempt summarization. It has no repeat comparison, alerts,
redirects, savings features, IDE integration, or agent control.

## Capture mechanism

Watchtower is a local Claude Code hook command. Claude Code passes a structured JSON hook payload
on stdin. On every lifecycle hook, Watchtower immediately appends that payload and any newly completed
JSONL records in Claude Code's `transcript_path` to `~/.watchtower/sessions/<session_id>/raw.jsonl`.
It tracks a byte offset per transcript and never scrapes terminal or screen output. The transcript is
the source of user/assistant content; hooks provide low-latency lifecycle/tool observations.

Add this command to the Claude Code hooks for `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `PostToolUseFailure`, and `Stop` (use an absolute repository path):

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node --experimental-strip-types /ABSOLUTE/PATH/watchtower/cli/capture-hook.ts" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node --experimental-strip-types /ABSOLUTE/PATH/watchtower/cli/capture-hook.ts" }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --experimental-strip-types /ABSOLUTE/PATH/watchtower/cli/capture-hook.ts" }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --experimental-strip-types /ABSOLUTE/PATH/watchtower/cli/capture-hook.ts" }] }],
    "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node --experimental-strip-types /ABSOLUTE/PATH/watchtower/cli/capture-hook.ts" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node --experimental-strip-types /ABSOLUTE/PATH/watchtower/cli/capture-hook.ts" }] }]
  }
}
```

Set `WATCHTOWER_DATA_DIR` to override the local data directory. Files are created with owner-only
permissions. Capture errors become raw events; there is no screen-scraping fallback.

## Inspecting a session

```sh
npm run watchtower:process -- ~/.watchtower/sessions/<session-id>/raw.jsonl
```

The resulting `inspection.json` exposes every raw envelope and normalized event, each attempt's event
IDs (the active-attempt membership), boundary reason, evidence, and summary.

## Schemas and heuristics

Raw envelopes retain the complete payload plus capture ID/time, session ID, event type, source role,
tool-use ID, and whether the record came from a hook or transcript. Normalized events retain their raw
envelope and expose messages, tools, results, commands/stdout/stderr/exit status, edits, and errors.

An attempt is one coherent strategy. V1 ends it on a user correction after actions, a new intent after
failure evidence, explicit successful validation, or session end. These boundaries are deliberately
inspectable and confidence-scored, not asserted as objective. Failure detectors combine structure
(non-zero status and tool errors) with generic patterns for tests, builds, assertions, validation,
timeouts, and assistant/user acknowledgements. Additional detectors can be injected.

Summaries use a local deterministic implementation behind `AttemptSummarizer`; no LLM is used and no
data leaves the machine. Intent and problem descriptions are extractive, so implicit strategies,
unusual tool schemas, absent exit statuses, and domain-specific failure language remain heuristic.

## Acceptance status in this environment

The pipeline is covered with a Claude-transcript-shaped incremental-capture test, including a test
failure in a successful (`is_error: false`) tool result. This is not claimed as the required live proof.
The build environment had no `claude` executable or existing Claude transcript, so a real Claude Code
session could not be run here. Live Phase 1 acceptance, and therefore real end-to-end Phase 5 acceptance,
remain blocked until the hook is exercised in an authenticated Claude Code installation.
