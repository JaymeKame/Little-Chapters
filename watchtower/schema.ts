export type EventCategory =
  | "session" | "user_message" | "assistant_message" | "tool_use"
  | "tool_result" | "command_execution" | "file_edit" | "error" | "unknown";

export type RawEnvelope = {
  captureId: string;
  capturedAt: string;
  sessionId: string;
  eventType: string;
  sourceRole?: string;
  toolUseId?: string;
  source: "hook" | "transcript";
  payload: Record<string, unknown>;
};

export type NormalizedEvent = {
  id: string;
  sessionId: string;
  timestamp: string;
  category: EventCategory;
  sourceRole?: string;
  userMessage?: string;
  assistantMessage?: string;
  toolUse?: { id?: string; name: string; input: unknown };
  toolResult?: { toolUseId?: string; content: unknown };
  command?: { command: string; stdout?: string; stderr?: string; exitStatus?: number };
  fileEdits?: string[];
  explicitError: boolean;
  rawSource: RawEnvelope;
};

export type AttemptOutcome = "success" | "failure" | "unresolved";

export type Attempt = {
  id: string;
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  sourceEventIds: string[];
  problem: string;
  intendedApproach: string;
  actionsTaken: string[];
  filesTouched: string[];
  commandsRun: string[];
  evidenceObserved: string[];
  inferredOutcome: AttemptOutcome;
  boundaryReason: string;
  segmentationConfidence: number;
};

export type FailureEvidence = {
  id: string;
  attemptId: string;
  sourceEventId: string;
  type: "non_zero_exit" | "test_failure" | "build_failure" | "assertion_failure" |
    "validation_failure" | "timeout" | "tool_error" | "assistant_acknowledgement" | "user_correction";
  rawText: string;
  description: string;
  confidence: number;
  severity: "warning" | "error";
};

export type AttemptSummary = {
  attemptId: string;
  problemBeingAddressed: string;
  intendedApproach: string;
  actionsTaken: string[];
  importantFilesOrComponents: string[];
  observedEvidence: string[];
  inferredOutcome: AttemptOutcome;
  failureReason?: string;
  appearsToHaveAddressed: string;
  mayRemainUnresolved: string;
  uncertaintyAndCaveats: string[];
};
