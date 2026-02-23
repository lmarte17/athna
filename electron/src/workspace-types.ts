export const WORKSPACE_CHANNELS = {
  getState: "workspace:get-state",
  createTab: "workspace:create-tab",
  switchTab: "workspace:switch-tab",
  closeTab: "workspace:close-tab",
  submitCommand: "workspace:submit-command",
  stateEvent: "workspace:state",
  focusEvent: "workspace:command-focus"
} as const;

export const COMMAND_MODES = ["AUTO", "BROWSE", "DO", "MAKE", "RESEARCH"] as const;
export type CommandMode = (typeof COMMAND_MODES)[number];

export const COMMAND_INTENTS = ["NAVIGATE", "RESEARCH", "TRANSACT", "GENERATE"] as const;
export type CommandIntent = (typeof COMMAND_INTENTS)[number];

export type CommandClassificationSource = "AUTO_RULES" | "MODE_OVERRIDE";
export type CommandExecutionRoute =
  | "FOREGROUND_NAVIGATION"
  | "GHOST_RESEARCH"
  | "GHOST_TRANSACT"
  | "MAKER_GENERATE";
export type CommandPrimaryEngine = "NAVIGATOR" | "MAKER";

export type CommandBarSource = "START_PAGE" | "TOP_BAR";
export type CommandFocusTarget = "START_PAGE" | "TOP_BAR";

export interface WorkspaceTabState {
  id: string;
  title: string;
  kind: "START" | "WEB";
  url: string;
  loading: boolean;
  canClose: boolean;
}

export interface CommandClassification {
  intent: CommandIntent;
  source: CommandClassificationSource;
  confidence: number;
  reason: string;
}

export interface CommandExecutionPlan {
  route: CommandExecutionRoute;
  runInTopTab: boolean;
  spawnGhostTabs: boolean;
  primaryEngine: CommandPrimaryEngine;
}

export interface CommandDispatchRecord {
  dispatchId: string;
  submittedAt: string;
  source: CommandBarSource;
  mode: CommandMode;
  modeOverride: Exclude<CommandMode, "AUTO"> | null;
  workspaceContextId: string;
  rawInput: string;
  normalizedUrl: string | null;
  classification: CommandClassification;
  executionPlan: CommandExecutionPlan;
  taskId: string | null;
}

export type WorkspaceTaskStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface WorkspaceTaskSummary {
  taskId: string;
  workspaceContextId: string;
  intent: CommandIntent;
  route: CommandExecutionRoute;
  status: WorkspaceTaskStatus;
  rawInput: string;
  startUrl: string;
  currentUrl: string | null;
  currentState: string | null;
  currentAction: string | null;
  progressLabel: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  finalUrl: string | null;
}

export interface WorkspaceState {
  tabs: WorkspaceTabState[];
  activeTabId: string;
  isStartPageActive: boolean;
  lastDispatch: CommandDispatchRecord | null;
  tasks: WorkspaceTaskSummary[];
}

export interface WorkspaceCommandSubmission {
  text: string;
  mode: CommandMode;
  source: CommandBarSource;
}

export interface WorkspaceCommandSubmissionResult {
  accepted: boolean;
  clearInput: boolean;
  error: string | null;
  dispatch: CommandDispatchRecord | null;
}
