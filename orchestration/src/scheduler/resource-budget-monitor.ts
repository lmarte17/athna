import type { GhostTabCdpClient, GhostTabResourceMetrics } from "../cdp/client.js";

export type ResourceBudgetEnforcementMode = "WARN_ONLY" | "KILL_TAB";

export interface GhostTabResourceBudgetViolation {
  taskId: string;
  contextId: string;
  triggeredAt: string;
  cpuBudgetPercentPerCore: number;
  memoryBudgetMb: number;
  violationWindowMs: number;
  enforcementMode: ResourceBudgetEnforcementMode;
  observedCpuPercent: number | null;
  observedMemoryMb: number | null;
  sustainedCpuOverBudgetMs: number;
  sustainedMemoryOverBudgetMs: number;
  cpuExceeded: boolean;
  memoryExceeded: boolean;
}

export interface GhostTabResourceBudgetMonitorOptions {
  taskId: string;
  contextId: string;
  cdpClient: GhostTabCdpClient;
  cpuBudgetPercentPerCore: number;
  memoryBudgetMb: number;
  violationWindowMs: number;
  sampleIntervalMs: number;
  enforcementMode: ResourceBudgetEnforcementMode;
  logger?: (line: string) => void;
  onViolation?: (violation: GhostTabResourceBudgetViolation) => void;
}

export class GhostTabResourceBudgetMonitor {
  private readonly logger: (line: string) => void;
  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;
  private previousSample: GhostTabResourceMetrics | null = null;
  private cpuOverBudgetSinceMs: number | null = null;
  private memoryOverBudgetSinceMs: number | null = null;
  private violation: GhostTabResourceBudgetViolation | null = null;
  private killTriggered = false;

  constructor(private readonly options: GhostTabResourceBudgetMonitorOptions) {
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  start(): void {
    if (this.loopPromise) {
      return;
    }
    this.stopRequested = false;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (!this.loopPromise) {
      return;
    }

    await this.loopPromise.catch(() => {
      // monitor errors are surfaced through task execution paths.
    });
    this.loopPromise = null;
  }

  getViolation(): GhostTabResourceBudgetViolation | null {
    return this.violation;
  }

  didKillTab(): boolean {
    return this.killTriggered;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopRequested) {
      let sample: GhostTabResourceMetrics;
      try {
        sample = await this.options.cdpClient.sampleResourceMetrics();
      } catch (error) {
        if (!this.stopRequested) {
          this.logger(
            `[resource-budget] sample-failed taskId=${this.options.taskId} contextId=${this.options.contextId} error=${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        await sleep(this.options.sampleIntervalMs);
        continue;
      }

      const observedCpuPercent = computeCpuPercentOfCore(this.previousSample, sample);
      const observedMemoryMb = toMb(sample.jsHeapUsedBytes);
      const nowMs = sample.timestampMs;

      this.cpuOverBudgetSinceMs = updateOverBudgetSince({
        overBudgetSinceMs: this.cpuOverBudgetSinceMs,
        observed: observedCpuPercent,
        budget: this.options.cpuBudgetPercentPerCore,
        nowMs
      });
      this.memoryOverBudgetSinceMs = updateOverBudgetSince({
        overBudgetSinceMs: this.memoryOverBudgetSinceMs,
        observed: observedMemoryMb,
        budget: this.options.memoryBudgetMb,
        nowMs
      });

      const sustainedCpuOverBudgetMs =
        this.cpuOverBudgetSinceMs === null ? 0 : nowMs - this.cpuOverBudgetSinceMs;
      const sustainedMemoryOverBudgetMs =
        this.memoryOverBudgetSinceMs === null ? 0 : nowMs - this.memoryOverBudgetSinceMs;
      const cpuExceeded = sustainedCpuOverBudgetMs >= this.options.violationWindowMs;
      const memoryExceeded = sustainedMemoryOverBudgetMs >= this.options.violationWindowMs;
      const violationDetected = cpuExceeded || memoryExceeded;

      if (this.violation === null && violationDetected) {
        const violation: GhostTabResourceBudgetViolation = {
          taskId: this.options.taskId,
          contextId: this.options.contextId,
          triggeredAt: new Date(nowMs).toISOString(),
          cpuBudgetPercentPerCore: this.options.cpuBudgetPercentPerCore,
          memoryBudgetMb: this.options.memoryBudgetMb,
          violationWindowMs: this.options.violationWindowMs,
          enforcementMode: this.options.enforcementMode,
          observedCpuPercent,
          observedMemoryMb,
          sustainedCpuOverBudgetMs,
          sustainedMemoryOverBudgetMs,
          cpuExceeded,
          memoryExceeded
        };
        this.violation = violation;
        this.options.onViolation?.(violation);

        this.logger(
          `[resource-budget] violation taskId=${violation.taskId} contextId=${violation.contextId} cpuPct=${fmtNumber(
            violation.observedCpuPercent
          )} cpuBudget=${violation.cpuBudgetPercentPerCore} memoryMb=${fmtNumber(
            violation.observedMemoryMb
          )} memoryBudget=${violation.memoryBudgetMb} sustainedCpuMs=${violation.sustainedCpuOverBudgetMs} sustainedMemoryMs=${violation.sustainedMemoryOverBudgetMs} mode=${violation.enforcementMode}`
        );

        if (violation.enforcementMode === "KILL_TAB") {
          this.killTriggered = true;
          this.stopRequested = true;
          await this.options.cdpClient.closeTarget().catch(() => {
            // best-effort kill in enforcement mode
          });
          return;
        }
      }

      this.previousSample = sample;
      await sleep(this.options.sampleIntervalMs);
    }
  }
}

function computeCpuPercentOfCore(
  previousSample: GhostTabResourceMetrics | null,
  nextSample: GhostTabResourceMetrics
): number | null {
  if (!previousSample) {
    return null;
  }

  if (
    previousSample.taskDurationSeconds === null ||
    nextSample.taskDurationSeconds === null ||
    !Number.isFinite(previousSample.taskDurationSeconds) ||
    !Number.isFinite(nextSample.taskDurationSeconds)
  ) {
    return null;
  }

  const deltaTaskSeconds = nextSample.taskDurationSeconds - previousSample.taskDurationSeconds;
  const deltaWallSeconds = (nextSample.timestampMs - previousSample.timestampMs) / 1_000;
  if (deltaWallSeconds <= 0 || deltaTaskSeconds < 0) {
    return null;
  }

  return (deltaTaskSeconds / deltaWallSeconds) * 100;
}

function updateOverBudgetSince(input: {
  overBudgetSinceMs: number | null;
  observed: number | null;
  budget: number;
  nowMs: number;
}): number | null {
  if (input.observed === null || !Number.isFinite(input.observed)) {
    return null;
  }

  if (input.observed > input.budget) {
    return input.overBudgetSinceMs ?? input.nowMs;
  }

  return null;
}

function toMb(bytes: number | null): number | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }

  return bytes / (1024 * 1024);
}

function fmtNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(3);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
