export type GhostTabTaskState =
  | "IDLE"
  | "LOADING"
  | "PERCEIVING"
  | "INFERRING"
  | "ACTING"
  | "COMPLETE"
  | "FAILED";

export type GhostTabTaskErrorType =
  | "NETWORK"
  | "RUNTIME"
  | "CDP"
  | "TIMEOUT"
  | "VALIDATION"
  | "STATE"
  | "UNKNOWN";

export interface GhostTabTaskErrorDetail {
  type: GhostTabTaskErrorType;
  status: number | null;
  url: string | null;
  message: string;
  retryable: boolean;
  step: number | null;
}

export interface GhostTabStateTransitionContext {
  step?: number;
  url?: string;
  reason?: string;
  errorDetail?: GhostTabTaskErrorDetail;
}

export interface GhostTabStateTransitionEvent {
  taskId: string;
  contextId: string | null;
  from: GhostTabTaskState;
  to: GhostTabTaskState;
  timestamp: string;
  step: number | null;
  url: string | null;
  reason: string | null;
  errorDetail: GhostTabTaskErrorDetail | null;
}

export interface GhostTabTaskStateMachineOptions {
  taskId: string;
  contextId?: string | null;
  initialState?: GhostTabTaskState;
  onTransition?: (event: GhostTabStateTransitionEvent) => void;
}

export const ALLOWED_GHOST_TAB_STATE_TRANSITIONS: Record<
  GhostTabTaskState,
  readonly GhostTabTaskState[]
> = {
  IDLE: ["LOADING"],
  LOADING: ["PERCEIVING", "FAILED"],
  PERCEIVING: ["INFERRING", "FAILED"],
  INFERRING: ["ACTING", "FAILED"],
  ACTING: ["PERCEIVING", "COMPLETE", "FAILED"],
  COMPLETE: ["IDLE"],
  FAILED: ["IDLE"]
};

export class InvalidGhostTabStateTransitionError extends Error {
  readonly from: GhostTabTaskState;
  readonly to: GhostTabTaskState;

  constructor(from: GhostTabTaskState, to: GhostTabTaskState) {
    super(
      `Invalid Ghost Tab state transition: ${from} -> ${to}. Allowed: ${ALLOWED_GHOST_TAB_STATE_TRANSITIONS[
        from
      ].join(", ")}`
    );
    this.name = "InvalidGhostTabStateTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class GhostTabTaskStateMachine {
  private currentState: GhostTabTaskState;
  private readonly transitions: GhostTabStateTransitionEvent[] = [];

  private readonly onTransition: (event: GhostTabStateTransitionEvent) => void;

  constructor(private readonly options: GhostTabTaskStateMachineOptions) {
    const taskId = options.taskId?.trim();
    if (!taskId) {
      throw new Error("GhostTabTaskStateMachine requires a non-empty taskId.");
    }

    this.currentState = options.initialState ?? "IDLE";
    this.onTransition = options.onTransition ?? (() => {});
  }

  getState(): GhostTabTaskState {
    return this.currentState;
  }

  getTransitionHistory(): GhostTabStateTransitionEvent[] {
    return [...this.transitions];
  }

  canTransition(to: GhostTabTaskState): boolean {
    return ALLOWED_GHOST_TAB_STATE_TRANSITIONS[this.currentState].includes(to);
  }

  transition(
    to: GhostTabTaskState,
    context: GhostTabStateTransitionContext = {}
  ): GhostTabStateTransitionEvent {
    if (!this.canTransition(to)) {
      throw new InvalidGhostTabStateTransitionError(this.currentState, to);
    }

    const event: GhostTabStateTransitionEvent = {
      taskId: this.options.taskId,
      contextId: this.options.contextId ?? null,
      from: this.currentState,
      to,
      timestamp: new Date().toISOString(),
      step: context.step ?? null,
      url: context.url ?? null,
      reason: context.reason ?? null,
      errorDetail: context.errorDetail ?? null
    };

    this.currentState = to;
    this.transitions.push(event);
    this.onTransition(event);
    return event;
  }
}

export function classifyTaskErrorType(error: unknown): GhostTabTaskErrorType {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out/i.test(message)) {
    return "TIMEOUT";
  }
  if (/cdp|devtools|protocol|page\.navigate|accessibility\.getfullaxtree|input\./i.test(message)) {
    return "CDP";
  }
  if (/network|dns|tls|http|connection|fetch/i.test(message)) {
    return "NETWORK";
  }
  if (/invalid|must be|required/i.test(message)) {
    return "VALIDATION";
  }
  if (/state transition|state machine|policy violation/i.test(message)) {
    return "STATE";
  }
  if (/runtime|javascript|mutation/i.test(message)) {
    return "RUNTIME";
  }
  return "UNKNOWN";
}

export function createGhostTabTaskErrorDetail(input: {
  error: unknown;
  url?: string | null;
  step?: number | null;
  status?: number | null;
  type?: GhostTabTaskErrorType;
  retryable?: boolean;
}): GhostTabTaskErrorDetail {
  const message =
    input.error instanceof Error ? input.error.message : `Unknown failure: ${String(input.error)}`;
  const type = input.type ?? classifyTaskErrorType(input.error);
  const retryable =
    typeof input.retryable === "boolean"
      ? input.retryable
      : type === "NETWORK" || type === "TIMEOUT" || type === "CDP";

  return {
    type,
    status: input.status ?? null,
    url: input.url ?? null,
    message,
    retryable,
    step: input.step ?? null
  };
}

export function createGhostTabTaskStateMachine(
  options: GhostTabTaskStateMachineOptions
): GhostTabTaskStateMachine {
  return new GhostTabTaskStateMachine(options);
}
