import type {
  GhostTabCdpClient,
  GhostTabCrashEvent
} from "../cdp/client.js";
import {
  createGhostTabIpcMessage,
  type GhostTabIpcTaskStatusMessage,
  type TaskStatusIpcPayload
} from "../ipc/schema.js";
import {
  createGhostTabPoolManager,
  type GhostTabLease,
  type GhostTabPoolManager,
  type GhostTabPoolManagerOptions,
  type GhostTabPoolSnapshot,
  type GhostTabQueueStatusEvent,
  type GhostTabTaskPriority
} from "../pool/manager.js";
import {
  GhostTabResourceBudgetMonitor,
  type GhostTabResourceBudgetViolation,
  type ResourceBudgetEnforcementMode
} from "./resource-budget-monitor.js";
import {
  createGhostTabTaskErrorDetail,
  type GhostTabStateTransitionEvent,
  type GhostTabTaskErrorDetail
} from "../task/state-machine.js";

const UNKNOWN_CONTEXT_ID = "unknown-context";
const DEFAULT_CRASH_RETRY_LIMIT = 2;
const DEFAULT_RESOURCE_BUDGET_ENABLED = true;
const DEFAULT_RESOURCE_CPU_BUDGET_PERCENT = 25;
const DEFAULT_RESOURCE_MEMORY_BUDGET_MB = 512;
const DEFAULT_RESOURCE_VIOLATION_WINDOW_MS = 10_000;
const DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_RESOURCE_ENFORCEMENT_MODE: ResourceBudgetEnforcementMode = "WARN_ONLY";

export interface ParallelTaskRunnerInput<TTaskInput> {
  taskId: string;
  priority: GhostTabTaskPriority;
  attempt: number;
  maxAttempts: number;
  input: TTaskInput;
  lease: GhostTabLease;
  cdpClient: GhostTabCdpClient;
  emitTaskStatus: (payload: TaskStatusIpcPayload) => void;
}

export interface SubmitParallelTaskInput<TTaskInput> {
  taskId: string;
  input: TTaskInput;
  priority?: GhostTabTaskPriority;
}

export interface ParallelTaskAttemptResult {
  attempt: number;
  contextId: string;
  assignmentWaitMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "SUCCEEDED" | "FAILED";
  crashDetected: boolean;
  resourceViolation: GhostTabResourceBudgetViolation | null;
  errorDetail: GhostTabTaskErrorDetail | null;
}

export interface ParallelTaskRunResult<TResult> {
  taskId: string;
  contextId: string;
  priority: GhostTabTaskPriority;
  assignmentWaitMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attemptsUsed: number;
  attempts: ParallelTaskAttemptResult[];
  result: TResult;
}

export interface ParallelTaskCrashRecoveryOptions {
  maxRetries?: number;
}

export interface ParallelTaskResourceBudgetOptions {
  enabled?: boolean;
  cpuBudgetPercentPerCore?: number;
  memoryBudgetMb?: number;
  violationWindowMs?: number;
  sampleIntervalMs?: number;
  enforcementMode?: ResourceBudgetEnforcementMode;
}

export interface ParallelTaskSchedulerOptions<TTaskInput, TResult> {
  endpointURL: string;
  runTask: (input: ParallelTaskRunnerInput<TTaskInput>) => Promise<TResult>;
  minSize?: number;
  maxSize?: number;
  contextIdPrefix?: string;
  connectTimeoutMs?: number;
  logger?: (line: string) => void;
  onStatusMessage?: (message: GhostTabIpcTaskStatusMessage) => void;
  crashRecovery?: ParallelTaskCrashRecoveryOptions;
  resourceBudget?: ParallelTaskResourceBudgetOptions;
}

export class ParallelTaskExecutionError extends Error {
  constructor(
    readonly taskId: string,
    readonly errorDetail: GhostTabTaskErrorDetail,
    readonly attemptsUsed: number,
    readonly attempts: ParallelTaskAttemptResult[]
  ) {
    super(`[scheduler] task ${taskId} failed: ${errorDetail.message}`);
    this.name = "ParallelTaskExecutionError";
  }
}

interface ResolvedCrashRecoveryOptions {
  maxRetries: number;
}

interface ResolvedResourceBudgetOptions {
  enabled: boolean;
  cpuBudgetPercentPerCore: number;
  memoryBudgetMb: number;
  violationWindowMs: number;
  sampleIntervalMs: number;
  enforcementMode: ResourceBudgetEnforcementMode;
}

export class ParallelTaskScheduler<TTaskInput, TResult> {
  private readonly logger: (line: string) => void;
  private readonly pool: GhostTabPoolManager;
  private readonly crashRecovery: ResolvedCrashRecoveryOptions;
  private readonly resourceBudget: ResolvedResourceBudgetOptions;
  private readonly activeTaskIds = new Set<string>();
  private readonly runningTasks = new Map<string, Promise<ParallelTaskRunResult<TResult>>>();
  private initialized = false;
  private shuttingDown = false;

  constructor(private readonly options: ParallelTaskSchedulerOptions<TTaskInput, TResult>) {
    this.logger = options.logger ?? ((line: string) => console.info(line));
    this.crashRecovery = resolveCrashRecoveryOptions(options.crashRecovery);
    this.resourceBudget = resolveResourceBudgetOptions(options.resourceBudget);

    const poolOptions: GhostTabPoolManagerOptions = {
      endpointURL: options.endpointURL,
      minSize: options.minSize,
      maxSize: options.maxSize,
      contextIdPrefix: options.contextIdPrefix,
      connectTimeoutMs: options.connectTimeoutMs,
      logger: this.logger,
      onTaskStateTransition: (event) => {
        this.emitStateStatusMessage(event);
      },
      onQueueStatus: (event) => {
        this.emitQueueStatusMessage(event);
      }
    };
    this.pool = createGhostTabPoolManager(poolOptions);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.pool.initialize();
    this.initialized = true;
  }

  submitTask(input: SubmitParallelTaskInput<TTaskInput>): Promise<ParallelTaskRunResult<TResult>> {
    this.assertReady();
    const taskId = input.taskId?.trim();
    if (!taskId) {
      throw new Error("submitTask requires a non-empty taskId.");
    }

    if (this.activeTaskIds.has(taskId)) {
      throw new Error(`submitTask received duplicate taskId=${taskId}.`);
    }

    const priority = input.priority ?? "BACKGROUND";
    this.activeTaskIds.add(taskId);

    const runPromise = this.runSubmittedTask({
      taskId,
      priority,
      input: input.input
    }).finally(() => {
      this.activeTaskIds.delete(taskId);
      this.runningTasks.delete(taskId);
    });

    this.runningTasks.set(taskId, runPromise);
    return runPromise;
  }

  getPoolSnapshot(): GhostTabPoolSnapshot {
    this.assertReady();
    return this.pool.getSnapshot();
  }

  getPoolTelemetry(): ReturnType<GhostTabPoolManager["getTelemetry"]> {
    this.assertReady();
    return this.pool.getTelemetry();
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.shuttingDown = true;
    await this.pool.shutdown();
    await Promise.allSettled([...this.runningTasks.values()]);
    this.runningTasks.clear();
    this.activeTaskIds.clear();
    this.initialized = false;
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error("ParallelTaskScheduler.initialize() must complete before use.");
    }
    if (this.shuttingDown) {
      throw new Error("ParallelTaskScheduler is shutting down.");
    }
  }

  private async runSubmittedTask(input: {
    taskId: string;
    priority: GhostTabTaskPriority;
    input: TTaskInput;
  }): Promise<ParallelTaskRunResult<TResult>> {
    const maxAttempts = this.crashRecovery.maxRetries + 1;
    const taskStartedAtMs = Date.now();
    const taskStartedAt = new Date(taskStartedAtMs).toISOString();
    const attemptHistory: ParallelTaskAttemptResult[] = [];

    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      const lease = await this.pool.acquireGhostTab({
        taskId: input.taskId,
        priority: input.priority
      });
      const attemptStartedAtMs = Date.now();
      const attemptStartedAt = new Date(attemptStartedAtMs).toISOString();
      const contextId = lease.contextId;

      let crashEvent: GhostTabCrashEvent | null = null;
      const removeCrashListener = lease.cdpClient.onTargetCrashed((event) => {
        crashEvent = event;
      });
      const resourceMonitor = this.createResourceMonitor({
        taskId: input.taskId,
        contextId,
        lease,
        priority: input.priority
      });
      resourceMonitor?.start();

      this.emitSchedulerStatusMessage({
        taskId: input.taskId,
        contextId,
        priority: input.priority,
        event: "STARTED",
        assignmentWaitMs: lease.assignmentWaitMs,
        durationMs: null,
        error: null
      });

      let runResult: TResult | null = null;
      let runError: unknown = null;
      try {
        runResult = await this.options.runTask({
          taskId: input.taskId,
          priority: input.priority,
          attempt,
          maxAttempts,
          input: input.input,
          lease,
          cdpClient: lease.cdpClient,
          emitTaskStatus: (payload) => {
            this.emitTaskStatusPayload({
              taskId: input.taskId,
              contextId,
              payload
            });
          }
        });
      } catch (error) {
        runError = error;
      }

      await resourceMonitor?.stop();
      removeCrashListener();
      await lease.release().catch(() => {
        // shutdown can invalidate leases while a task is finishing.
      });

      const attemptDurationMs = Date.now() - attemptStartedAtMs;
      const attemptFinishedAt = new Date().toISOString();
      const observedCrash =
        crashEvent ?? lease.cdpClient.getLastCrashEvent() ?? null;
      const crashDetected = observedCrash !== null || isCrashLikeError(runError);
      const resourceViolation = resourceMonitor?.getViolation() ?? null;
      const resourceKilledTab = resourceMonitor?.didKillTab() ?? false;

      if (runResult !== null && !crashDetected && !resourceKilledTab) {
        const successAttempt: ParallelTaskAttemptResult = {
          attempt,
          contextId,
          assignmentWaitMs: lease.assignmentWaitMs,
          startedAt: attemptStartedAt,
          finishedAt: attemptFinishedAt,
          durationMs: attemptDurationMs,
          status: "SUCCEEDED",
          crashDetected: false,
          resourceViolation,
          errorDetail: null
        };
        attemptHistory.push(successAttempt);

        this.emitSchedulerStatusMessage({
          taskId: input.taskId,
          contextId,
          priority: input.priority,
          event: "SUCCEEDED",
          assignmentWaitMs: lease.assignmentWaitMs,
          durationMs: attemptDurationMs,
          error: null
        });

        return {
          taskId: input.taskId,
          contextId,
          priority: input.priority,
          assignmentWaitMs: lease.assignmentWaitMs,
          startedAt: taskStartedAt,
          finishedAt: attemptFinishedAt,
          durationMs: Date.now() - taskStartedAtMs,
          attemptsUsed: attempt,
          attempts: attemptHistory,
          result: runResult
        };
      }

      let failureError: unknown = runError;
      if (!failureError && crashDetected) {
        const crashMessage = buildCrashMessage(observedCrash);
        failureError = new Error(crashMessage);
      }
      if (!failureError && resourceKilledTab) {
        failureError = new Error(
          `Resource budget exceeded for task ${input.taskId} in ${contextId}; tab was killed.`
        );
      }
      if (!failureError && resourceViolation) {
        failureError = new Error(
          `Resource budget exceeded for task ${input.taskId} in ${contextId} (warn-only mode).`
        );
      }
      if (!failureError) {
        failureError = new Error(`Task ${input.taskId} failed without an explicit error.`);
      }

      const errorDetail = createGhostTabTaskErrorDetail({
        error: failureError,
        retryable: crashDetected
      });
      const failedAttempt: ParallelTaskAttemptResult = {
        attempt,
        contextId,
        assignmentWaitMs: lease.assignmentWaitMs,
        startedAt: attemptStartedAt,
        finishedAt: attemptFinishedAt,
        durationMs: attemptDurationMs,
        status: "FAILED",
        crashDetected,
        resourceViolation,
        errorDetail
      };
      attemptHistory.push(failedAttempt);

      if (resourceViolation) {
        this.emitSchedulerStatusMessage({
          taskId: input.taskId,
          contextId,
          priority: input.priority,
          event: resourceKilledTab ? "RESOURCE_BUDGET_KILLED" : "RESOURCE_BUDGET_EXCEEDED",
          assignmentWaitMs: lease.assignmentWaitMs,
          durationMs: attemptDurationMs,
          error: errorDetail
        });
      }

      if (crashDetected) {
        this.emitSchedulerStatusMessage({
          taskId: input.taskId,
          contextId,
          priority: input.priority,
          event: "CRASH_DETECTED",
          assignmentWaitMs: lease.assignmentWaitMs,
          durationMs: attemptDurationMs,
          error: errorDetail
        });
      }

      const canRetry = crashDetected && attempt < maxAttempts;
      if (canRetry) {
        this.emitSchedulerStatusMessage({
          taskId: input.taskId,
          contextId,
          priority: input.priority,
          event: "RETRYING",
          assignmentWaitMs: lease.assignmentWaitMs,
          durationMs: attemptDurationMs,
          error: errorDetail
        });
        this.logger(
          `[scheduler] retrying taskId=${input.taskId} attempt=${attempt}/${maxAttempts} contextId=${contextId}`
        );
        continue;
      }

      this.emitSchedulerStatusMessage({
        taskId: input.taskId,
        contextId,
        priority: input.priority,
        event: "FAILED",
        assignmentWaitMs: lease.assignmentWaitMs,
        durationMs: attemptDurationMs,
        error: errorDetail
      });

      throw new ParallelTaskExecutionError(input.taskId, errorDetail, attempt, attemptHistory);
    }

    const exhaustedErrorDetail = createGhostTabTaskErrorDetail({
      error: new Error(
        `Task ${input.taskId} exhausted ${maxAttempts} attempts without a terminal result.`
      ),
      retryable: false
    });
    throw new ParallelTaskExecutionError(
      input.taskId,
      exhaustedErrorDetail,
      attemptHistory.length,
      attemptHistory
    );
  }

  private createResourceMonitor(input: {
    taskId: string;
    contextId: string;
    lease: GhostTabLease;
    priority: GhostTabTaskPriority;
  }): GhostTabResourceBudgetMonitor | null {
    if (!this.resourceBudget.enabled) {
      return null;
    }

    return new GhostTabResourceBudgetMonitor({
      taskId: input.taskId,
      contextId: input.contextId,
      cdpClient: input.lease.cdpClient,
      cpuBudgetPercentPerCore: this.resourceBudget.cpuBudgetPercentPerCore,
      memoryBudgetMb: this.resourceBudget.memoryBudgetMb,
      violationWindowMs: this.resourceBudget.violationWindowMs,
      sampleIntervalMs: this.resourceBudget.sampleIntervalMs,
      enforcementMode: this.resourceBudget.enforcementMode,
      logger: this.logger,
      onViolation: (violation) => {
        const errorDetail = createGhostTabTaskErrorDetail({
          error: new Error(
            `Resource budget violation taskId=${violation.taskId} contextId=${violation.contextId} cpuPct=${formatNumber(
              violation.observedCpuPercent
            )} memoryMb=${formatNumber(violation.observedMemoryMb)}`
          ),
          retryable: false
        });
        this.emitSchedulerStatusMessage({
          taskId: input.taskId,
          contextId: input.contextId,
          priority: input.priority,
          event:
            violation.enforcementMode === "KILL_TAB"
              ? "RESOURCE_BUDGET_KILLED"
              : "RESOURCE_BUDGET_EXCEEDED",
          assignmentWaitMs: input.lease.assignmentWaitMs,
          durationMs: null,
          error: errorDetail
        });
      }
    });
  }

  private emitQueueStatusMessage(event: GhostTabQueueStatusEvent): void {
    if (!this.options.onStatusMessage) {
      return;
    }

    const message = createGhostTabIpcMessage({
      type: "TASK_STATUS",
      taskId: event.taskId,
      contextId: event.contextId ?? UNKNOWN_CONTEXT_ID,
      payload: {
        kind: "QUEUE",
        event: event.eventType,
        priority: event.priority,
        queueDepth: event.queueDepth,
        available: event.available,
        inUse: event.inUse,
        contextId: event.contextId,
        waitMs: event.waitMs,
        wasQueued: event.wasQueued
      }
    });
    this.options.onStatusMessage(message);
  }

  private emitStateStatusMessage(event: GhostTabStateTransitionEvent): void {
    if (!this.options.onStatusMessage) {
      return;
    }

    const message = createGhostTabIpcMessage({
      type: "TASK_STATUS",
      taskId: event.taskId,
      contextId: event.contextId ?? UNKNOWN_CONTEXT_ID,
      payload: {
        kind: "STATE",
        from: event.from,
        to: event.to,
        step: event.step,
        url: event.url,
        reason: event.reason
      }
    });
    this.options.onStatusMessage(message);
  }

  private emitTaskStatusPayload(input: {
    taskId: string;
    contextId: string | null;
    payload: TaskStatusIpcPayload;
  }): void {
    if (!this.options.onStatusMessage) {
      return;
    }

    const message = createGhostTabIpcMessage({
      type: "TASK_STATUS",
      taskId: input.taskId,
      contextId: input.contextId ?? UNKNOWN_CONTEXT_ID,
      payload: input.payload
    });
    this.options.onStatusMessage(message);
  }

  private emitSchedulerStatusMessage(input: {
    taskId: string;
    contextId: string | null;
    priority: GhostTabTaskPriority;
    event:
      | "STARTED"
      | "SUCCEEDED"
      | "FAILED"
      | "CRASH_DETECTED"
      | "RETRYING"
      | "RESOURCE_BUDGET_EXCEEDED"
      | "RESOURCE_BUDGET_KILLED";
    assignmentWaitMs: number;
    durationMs: number | null;
    error: GhostTabTaskErrorDetail | null;
  }): void {
    if (!this.options.onStatusMessage) {
      return;
    }

    const message = createGhostTabIpcMessage({
      type: "TASK_STATUS",
      taskId: input.taskId,
      contextId: input.contextId ?? UNKNOWN_CONTEXT_ID,
      payload: {
        kind: "SCHEDULER",
        event: input.event,
        priority: input.priority,
        contextId: input.contextId,
        assignmentWaitMs: input.assignmentWaitMs,
        durationMs: input.durationMs,
        error: input.error
      }
    });
    this.options.onStatusMessage(message);
  }
}

function resolveCrashRecoveryOptions(
  options: ParallelTaskCrashRecoveryOptions | undefined
): ResolvedCrashRecoveryOptions {
  const maxRetries = options?.maxRetries ?? DEFAULT_CRASH_RETRY_LIMIT;
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error(`crashRecovery.maxRetries must be >= 0. Received: ${String(maxRetries)}`);
  }

  return {
    maxRetries
  };
}

function resolveResourceBudgetOptions(
  options: ParallelTaskResourceBudgetOptions | undefined
): ResolvedResourceBudgetOptions {
  const enabled = options?.enabled ?? DEFAULT_RESOURCE_BUDGET_ENABLED;
  const cpuBudgetPercentPerCore =
    options?.cpuBudgetPercentPerCore ?? DEFAULT_RESOURCE_CPU_BUDGET_PERCENT;
  const memoryBudgetMb = options?.memoryBudgetMb ?? DEFAULT_RESOURCE_MEMORY_BUDGET_MB;
  const violationWindowMs = options?.violationWindowMs ?? DEFAULT_RESOURCE_VIOLATION_WINDOW_MS;
  const sampleIntervalMs = options?.sampleIntervalMs ?? DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS;
  const enforcementMode = options?.enforcementMode ?? DEFAULT_RESOURCE_ENFORCEMENT_MODE;

  if (!Number.isFinite(cpuBudgetPercentPerCore) || cpuBudgetPercentPerCore <= 0) {
    throw new Error(
      `resourceBudget.cpuBudgetPercentPerCore must be > 0. Received: ${String(cpuBudgetPercentPerCore)}`
    );
  }
  if (!Number.isFinite(memoryBudgetMb) || memoryBudgetMb <= 0) {
    throw new Error(`resourceBudget.memoryBudgetMb must be > 0. Received: ${String(memoryBudgetMb)}`);
  }
  if (!Number.isFinite(violationWindowMs) || violationWindowMs <= 0) {
    throw new Error(
      `resourceBudget.violationWindowMs must be > 0. Received: ${String(violationWindowMs)}`
    );
  }
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) {
    throw new Error(
      `resourceBudget.sampleIntervalMs must be > 0. Received: ${String(sampleIntervalMs)}`
    );
  }
  if (enforcementMode !== "WARN_ONLY" && enforcementMode !== "KILL_TAB") {
    throw new Error(
      `resourceBudget.enforcementMode must be WARN_ONLY or KILL_TAB. Received: ${String(enforcementMode)}`
    );
  }

  return {
    enabled,
    cpuBudgetPercentPerCore,
    memoryBudgetMb,
    violationWindowMs,
    sampleIntervalMs,
    enforcementMode
  };
}

function isCrashLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /target crashed|page crashed|crash|target closed|session closed|browser has been closed/i.test(
    message
  );
}

function buildCrashMessage(event: GhostTabCrashEvent | null): string {
  if (!event) {
    return "Renderer crash detected.";
  }
  return `Renderer crash detected via ${event.source}: ${event.status ?? "unknown status"}`;
}

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(3);
}

export function createParallelTaskScheduler<TTaskInput, TResult>(
  options: ParallelTaskSchedulerOptions<TTaskInput, TResult>
): ParallelTaskScheduler<TTaskInput, TResult> {
  return new ParallelTaskScheduler(options);
}
