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
failure in a successful (`is_error: false`) tool result. Live acceptance was subsequently exercised
against a real Claude Code session by installing the hooks in `.claude/settings.local.json` and
processing the captured `raw.jsonl`; the normalization layer was then patched to match the observed
wire format (see the commit-log entries for details on the H1/C1/C2 defects and the two segmentation
refinements: execution-command-scoped `successful_validation` and pointer-corrected
`user_follow_up_or_correction`). Phase-1-5 acceptance is closed.

## Known architectural limitations (deferred, Phase-6-adjacent)

- **Segmenter operates on individual transcript events, not conversational turns.** A single
  assistant reply is emitted as multiple `assistant_message` events across tool-call cycles.
  A same-turn self-acknowledgement of failure ("X doesn't exist") followed by a same-turn
  intent word ("Let me try Y") therefore triggers a `strategy_change_after_failure_evidence`
  close inside what is really one coherent reply, over-fragmenting attempts. Proper fix
  requires surfacing `parentUuid` / turn-grouping information in the normalized schema and
  treating same-turn events as one composite for boundary evaluation. Deferred: this changes
  the schema and is Phase-6-adjacent architecture, not a Phase-1-5 blocker. Over-fragmentation
  (a real strategy split into extra pieces) is a safer failure mode for downstream reasoning
  to inherit than the alternative (distinct strategies merged into one attempt), so the
  current output is acceptable for Phase 6 to consume.

- **Hook-side failure signal is unreliable.** `PostToolUseFailure` does not fire in the
  observed Claude Code version, and `tool_response` exposes no `is_error` or `exit_code`.
  Reliable failure detection uses the transcript-side `tool_result.is_error` flag plus the
  targeted patterns in `structuralFailureInToolResult`. Hook envelopes retain the raw
  response (`stderr`, `interrupted`) for downstream extractors, but no first-class failure
  field is derived from them.

- **`thinking`, `interrupted`, and `queue-operation` are not first-class.** Assistant
  `thinking` blocks are silently dropped by normalization (`~10%` of assistant events in a
  live sample). `interrupted: true` in `PostToolUse.tool_response` is preserved raw but not
  extracted. `queue-operation` transcript records inflate the `unknown` category. Deferred
  as MEDIUM per Option 1 scope.
