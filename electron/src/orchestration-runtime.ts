import path from "node:path";

import type { CommandExecutionRoute, CommandIntent } from "./workspace-types.js";

const DEFAULT_ENDPOINT_RESOLVE_TIMEOUT_MS = 20_000;
const DEFAULT_ENDPOINT_POLL_INTERVAL_MS = 250;
const DEFAULT_TASK_MAX_STEPS = 20;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const TASK_PRIORITY_FOREGROUND = "FOREGROUND" as const;
const DEFAULT_GHOST_CONTEXT_COUNT = 1;
const DEFAULT_SCHEDULER_MIN_SIZE = 2;

type TaskStatusPayload =
  | {
      kind: "QUEUE";
      event: "ENQUEUED" | "DISPATCHED" | "RELEASED";
      priority: "FOREGROUND" | "BACKGROUND";
      queueDepth: number;
      available: number;
      inUse: number;
      contextId: string | null;
      waitMs: number | null;
      wasQueued: boolean;
    }
  | {
      kind: "STATE";
      from: string;
      to: string;
      step: number | null;
      url: string | null;
      reason: string | null;
    }
  | {
      kind: "SCHEDULER";
      event:
        | "STARTED"
        | "SUCCEEDED"
        | "FAILED"
        | "CRASH_DETECTED"
        | "RETRYING"
        | "RESOURCE_BUDGET_EXCEEDED"
        | "RESOURCE_BUDGET_KILLED";
      priority: "FOREGROUND" | "BACKGROUND";
      contextId: string | null;
      assignmentWaitMs: number;
      durationMs: number | null;
      error: {
        message: string;
      } | null;
    }
  | {
      kind: "SUBTASK";
      subtaskId: string;
      subtaskIntent: string;
      status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
      verificationType: string;
      verificationCondition: string;
      currentSubtaskIndex: number;
      totalSubtasks: number;
      attempt: number;
      checkpointLastCompletedSubtaskIndex: number;
      reason: string | null;
    };

export interface OrchestrationStatusMessage {
  taskId: string;
  contextId: string;
  payload: TaskStatusPayload;
}

interface TaskErrorDetail {
  message: string;
}

interface PerceptionActionTaskResultLike {
  status: "DONE" | "FAILED" | "MAX_STEPS";
  finalUrl: string;
  stepsTaken: number;
  errorDetail: TaskErrorDetail | null;
}

interface LoopLike {
  runTask(input: {
    intent: string;
    startUrl: string;
    taskId: string;
    contextId: string;
    maxSteps: number;
    navigationTimeoutMs: number;
  }): Promise<PerceptionActionTaskResultLike>;
}

interface NavigatorEngineLike {
  decideNextAction: (...args: unknown[]) => Promise<unknown>;
}

interface LeaseLike {
  contextId: string;
  transitionTaskState: (
    to: "IDLE" | "LOADING" | "PERCEIVING" | "INFERRING" | "ACTING" | "COMPLETE" | "FAILED",
    context?: {
      step?: number | null;
      url?: string | null;
      reason?: string | null;
    }
  ) => unknown;
}

interface CdpClientLike {
  navigate: (url: string, timeoutMs?: number) => Promise<unknown>;
}

interface ParallelRunInput<TInput> {
  taskId: string;
  input: TInput;
  lease: LeaseLike;
  cdpClient: CdpClientLike;
  emitTaskStatus: (payload: TaskStatusPayload) => void;
}

interface ParallelTaskRunResultLike<TResult> {
  taskId: string;
  contextId: string;
  durationMs: number;
  result: TResult;
}

interface ParallelTaskSchedulerLike<TInput, TResult> {
  initialize(): Promise<void>;
  submitTask(input: {
    taskId: string;
    input: TInput;
    priority?: "FOREGROUND" | "BACKGROUND";
  }): Promise<ParallelTaskRunResultLike<TResult>>;
  shutdown(): Promise<void>;
}

interface OrchestrationModule {
  createNavigatorEngine(): NavigatorEngineLike;
  createPerceptionActionLoop(options: {
    cdpClient: CdpClientLike;
    navigatorEngine: NavigatorEngineLike;
    taskId: string;
    contextId: string;
    onStateTransition?: (event: {
      to: "IDLE" | "LOADING" | "PERCEIVING" | "INFERRING" | "ACTING" | "COMPLETE" | "FAILED";
      step: number | null;
      url: string | null;
      reason: string | null;
    }) => void;
    onSubtaskStatus?: (event: {
      subtaskId: string;
      subtaskIntent: string;
      status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
      verificationType: string;
      verificationCondition: string;
      currentSubtaskIndex: number;
      totalSubtasks: number;
      attempt: number;
      checkpointLastCompletedSubtaskIndex: number;
      reason: string;
    }) => void;
    logger?: (line: string) => void;
  }): LoopLike;
  createParallelTaskScheduler<TInput, TResult>(options: {
    endpointURL: string;
    runTask: (input: ParallelRunInput<TInput>) => Promise<TResult>;
    minSize?: number;
    maxSize?: number;
    connectTimeoutMs?: number;
    logger?: (line: string) => void;
    onStatusMessage?: (message: OrchestrationStatusMessage) => void;
  }): ParallelTaskSchedulerLike<TInput, TResult>;
}

interface RuntimeTaskInput {
  intentText: string;
  intentKind: CommandIntent;
  route: CommandExecutionRoute;
  startUrl: string;
  workspaceContextId: string;
}

export interface RuntimeTaskSubmission {
  taskId: string;
  input: RuntimeTaskInput;
}

export interface RuntimeTaskResult {
  taskId: string;
  contextId: string | null;
  durationMs: number | null;
  status: PerceptionActionTaskResultLike["status"] | "FAILED";
  finalUrl: string | null;
  errorMessage: string | null;
}

export interface OrchestrationRuntimeOptions {
  remoteDebuggingPort: string;
  logger?: (line: string) => void;
  onStatusMessage?: (message: OrchestrationStatusMessage) => void;
}

export class OrchestrationRuntime {
  private readonly logger: (line: string) => void;
  private readonly remoteDebuggingPort: string;
  private readonly onStatusMessage?: (message: OrchestrationStatusMessage) => void;

  private scheduler: ParallelTaskSchedulerLike<RuntimeTaskInput, PerceptionActionTaskResultLike> | null = null;
  private schedulerPromise: Promise<
    ParallelTaskSchedulerLike<RuntimeTaskInput, PerceptionActionTaskResultLike>
  > | null = null;
  private navigatorEngine: NavigatorEngineLike | null = null;
  private module: OrchestrationModule | null = null;
  private shuttingDown = false;

  constructor(options: OrchestrationRuntimeOptions) {
    this.remoteDebuggingPort = options.remoteDebuggingPort;
    this.logger = options.logger ?? ((line: string) => console.info(line));
    this.onStatusMessage = options.onStatusMessage;
  }

  async submitTask(submission: RuntimeTaskSubmission): Promise<RuntimeTaskResult> {
    if (submission.input.intentKind === "GENERATE") {
      throw new Error(
        "Maker execution route is not implemented yet. GENERATE tasks are scheduled in Phase 7."
      );
    }

    const scheduler = await this.getOrCreateScheduler();
    const runResult = await scheduler.submitTask({
      taskId: submission.taskId,
      input: submission.input,
      priority: TASK_PRIORITY_FOREGROUND
    });

    return {
      taskId: runResult.taskId,
      contextId: runResult.contextId,
      durationMs: runResult.durationMs,
      status: runResult.result.status,
      finalUrl: runResult.result.finalUrl,
      errorMessage: runResult.result.errorDetail?.message ?? null
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.schedulerPromise = null;
    const scheduler = this.scheduler;
    this.scheduler = null;
    if (scheduler) {
      await scheduler.shutdown().catch((error: unknown) => {
        this.logger(
          `[orchestration-runtime] scheduler shutdown failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
  }

  private async getOrCreateScheduler(): Promise<
    ParallelTaskSchedulerLike<RuntimeTaskInput, PerceptionActionTaskResultLike>
  > {
    if (this.scheduler) {
      return this.scheduler;
    }
    if (this.shuttingDown) {
      throw new Error("Orchestration runtime is shutting down.");
    }
    if (!this.schedulerPromise) {
      this.schedulerPromise = this.createScheduler();
    }

    const scheduler = await this.schedulerPromise;
    this.scheduler = scheduler;
    return scheduler;
  }

  private async createScheduler(): Promise<
    ParallelTaskSchedulerLike<RuntimeTaskInput, PerceptionActionTaskResultLike>
  > {
    const module = this.getOrchestrationModule();
    const endpointURL = await resolveWebSocketDebuggerUrl(this.remoteDebuggingPort);
    const navigatorEngine = this.getOrCreateNavigatorEngine(module);
    const configuredContextCount = readPositiveIntegerEnv(
      "GHOST_CONTEXT_COUNT",
      DEFAULT_GHOST_CONTEXT_COUNT
    );
    const schedulerMaxSize = Math.max(1, configuredContextCount);
    const schedulerMinSize = Math.min(DEFAULT_SCHEDULER_MIN_SIZE, schedulerMaxSize);
    const scheduler = module.createParallelTaskScheduler<RuntimeTaskInput, PerceptionActionTaskResultLike>(
      {
        endpointURL,
        minSize: schedulerMinSize,
        maxSize: schedulerMaxSize,
        logger: (line) => this.logger(`[scheduler] ${line}`),
        onStatusMessage: (message) => {
          this.onStatusMessage?.(message);
        },
        runTask: async ({ taskId, input, lease, cdpClient, emitTaskStatus }) => {
          const loop = module.createPerceptionActionLoop({
            cdpClient,
            navigatorEngine,
            taskId,
            contextId: lease.contextId,
            onStateTransition: (event) => {
              if (event.to === "IDLE") {
                return;
              }
              safeTransitionTaskState(lease, event.to, {
                step: event.step,
                url: event.url,
                reason: event.reason
              });
            },
            onSubtaskStatus: (event) => {
              emitTaskStatus({
                kind: "SUBTASK",
                subtaskId: event.subtaskId,
                subtaskIntent: event.subtaskIntent,
                status: event.status,
                verificationType: event.verificationType,
                verificationCondition: event.verificationCondition,
                currentSubtaskIndex: event.currentSubtaskIndex,
                totalSubtasks: event.totalSubtasks,
                attempt: event.attempt,
                checkpointLastCompletedSubtaskIndex: event.checkpointLastCompletedSubtaskIndex,
                reason: event.reason
              });
            },
            logger: (line) => this.logger(`[loop:${taskId}] ${line}`)
          });

          try {
            await cdpClient.navigate(input.startUrl, DEFAULT_NAVIGATION_TIMEOUT_MS);
            const loopResult = await loop.runTask({
              taskId,
              contextId: lease.contextId,
              intent: input.intentText,
              startUrl: input.startUrl,
              maxSteps: DEFAULT_TASK_MAX_STEPS,
              navigationTimeoutMs: DEFAULT_NAVIGATION_TIMEOUT_MS
            });

            safeTransitionTaskState(lease, loopResult.status === "DONE" ? "COMPLETE" : "FAILED", {
              step: loopResult.stepsTaken,
              url: loopResult.finalUrl,
              reason: `LOOP_${loopResult.status}`
            });
            safeTransitionTaskState(lease, "IDLE", {
              step: loopResult.stepsTaken,
              url: loopResult.finalUrl,
              reason: "TASK_CONTEXT_CLEANUP"
            });

            return loopResult;
          } catch (error) {
            safeTransitionTaskState(lease, "FAILED", {
              step: null,
              url: null,
              reason: "LOOP_EXCEPTION"
            });
            safeTransitionTaskState(lease, "IDLE", {
              step: null,
              url: null,
              reason: "TASK_CONTEXT_CLEANUP"
            });
            throw error;
          }
        }
      }
    );

    await scheduler.initialize();
    return scheduler;
  }

  private getOrchestrationModule(): OrchestrationModule {
    if (this.module) {
      return this.module;
    }

    const modulePath = path.resolve(__dirname, "..", "..", "orchestration", "dist", "index.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(modulePath) as OrchestrationModule;
    this.module = loaded;
    return loaded;
  }

  private getOrCreateNavigatorEngine(module: OrchestrationModule): NavigatorEngineLike {
    if (this.navigatorEngine) {
      return this.navigatorEngine;
    }

    this.navigatorEngine = module.createNavigatorEngine();
    return this.navigatorEngine;
  }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function safeTransitionTaskState(
  lease: LeaseLike,
  to: "IDLE" | "LOADING" | "PERCEIVING" | "INFERRING" | "ACTING" | "COMPLETE" | "FAILED",
  context: {
    step?: number | null;
    url?: string | null;
    reason?: string | null;
  }
): void {
  try {
    lease.transitionTaskState(to, context);
  } catch {
    // Non-fatal; scheduler status events still provide task-level telemetry.
  }
}

async function resolveWebSocketDebuggerUrl(remoteDebuggingPort: string): Promise<string> {
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_ENDPOINT_RESOLVE_TIMEOUT_MS) {
    try {
      const response = await fetch(versionEndpoint);
      if (response.ok) {
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: string;
        };
        if (payload.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(DEFAULT_ENDPOINT_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out resolving CDP websocket endpoint from ${versionEndpoint}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
