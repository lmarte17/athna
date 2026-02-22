import {
  connectToGhostTabCdp,
  type ConnectToGhostTabCdpOptions,
  type GhostTabCdpClient
} from "../cdp/client.js";
import {
  createGhostTabTaskErrorDetail,
  createGhostTabTaskStateMachine,
  type GhostTabStateTransitionContext,
  type GhostTabStateTransitionEvent,
  type GhostTabTaskState
} from "../task/state-machine.js";

const DEFAULT_POOL_MIN_SIZE = 2;
const DEFAULT_POOL_MAX_SIZE = 6;
const DEFAULT_CONTEXT_ID_PREFIX = "ctx-";
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;

type PoolSlotState = "COLD" | "REPLENISHING" | "AVAILABLE" | "IN_USE";

interface PoolSlot {
  contextId: string;
  state: PoolSlotState;
  cdpClient: GhostTabCdpClient | null;
  lastWarmDurationMs: number | null;
}

interface AcquireRequest {
  requestedAtMs: number;
  taskId: string;
  priority: GhostTabTaskPriority;
  resolve: (lease: GhostTabLease) => void;
  reject: (error: unknown) => void;
}

export type GhostTabTaskPriority = "FOREGROUND" | "BACKGROUND";
export type GhostTabQueueStatusEventType = "ENQUEUED" | "DISPATCHED" | "RELEASED";

export interface GhostTabQueueStatusEvent {
  eventType: GhostTabQueueStatusEventType;
  taskId: string;
  priority: GhostTabTaskPriority;
  queueDepth: number;
  available: number;
  inUse: number;
  contextId: string | null;
  waitMs: number | null;
  wasQueued: boolean;
  timestamp: string;
}

export interface GhostTabPoolManagerOptions {
  endpointURL: string;
  minSize?: number;
  maxSize?: number;
  contextIdPrefix?: string;
  connectTimeoutMs?: number;
  logger?: (line: string) => void;
  onTaskStateTransition?: (event: GhostTabStateTransitionEvent) => void;
  onQueueStatus?: (event: GhostTabQueueStatusEvent) => void;
}

export interface AcquireGhostTabOptions {
  taskId: string;
  priority?: GhostTabTaskPriority;
}

export interface GhostTabLease {
  leaseId: string;
  taskId: string;
  contextId: string;
  assignmentWaitMs: number;
  cdpClient: GhostTabCdpClient;
  getTaskState: () => GhostTabTaskState;
  getTaskStateHistory: () => GhostTabStateTransitionEvent[];
  transitionTaskState: (
    to: GhostTabTaskState,
    context?: GhostTabStateTransitionContext
  ) => GhostTabStateTransitionEvent;
  release: () => Promise<void>;
}

export interface GhostTabPoolSnapshot {
  minSize: number;
  maxSize: number;
  totalSlots: number;
  cold: number;
  replenishing: number;
  available: number;
  inUse: number;
  queued: number;
  slotStates: Array<{
    contextId: string;
    state: PoolSlotState;
    lastWarmDurationMs: number | null;
  }>;
}

interface GhostTabPoolTelemetry {
  warmAssignmentCount: number;
  queuedAssignmentCount: number;
  averageWarmAssignmentWaitMs: number;
  averageQueueWaitMs: number;
  averageWarmDurationMs: number;
}

export class GhostTabPoolManager {
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly contextIdPrefix: string;
  private readonly connectTimeoutMs: number;
  private readonly logger: (line: string) => void;
  private readonly slots = new Map<string, PoolSlot>();
  private readonly availableContextIds: string[] = [];
  private readonly foregroundWaitQueue: AcquireRequest[] = [];
  private readonly backgroundWaitQueue: AcquireRequest[] = [];
  private readonly activeLeases = new Map<
    string,
    {
      taskId: string;
      priority: GhostTabTaskPriority;
      wasQueued: boolean;
      contextId: string;
      released: boolean;
      taskStateMachine: ReturnType<typeof createGhostTabTaskStateMachine>;
    }
  >();
  private readonly warmAssignmentWaits: number[] = [];
  private readonly queuedAssignmentWaits: number[] = [];
  private readonly warmDurations: number[] = [];
  private initialized = false;
  private replenishLoopPromise: Promise<void> | null = null;
  private nextLeaseId = 0;

  constructor(private readonly options: GhostTabPoolManagerOptions) {
    this.minSize = options.minSize ?? DEFAULT_POOL_MIN_SIZE;
    this.maxSize = options.maxSize ?? DEFAULT_POOL_MAX_SIZE;
    this.contextIdPrefix = options.contextIdPrefix ?? DEFAULT_CONTEXT_ID_PREFIX;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.logger = options.logger ?? ((line: string) => console.info(line));

    if (this.minSize <= 0 || this.maxSize <= 0) {
      throw new Error(
        `GhostTabPoolManager requires positive pool sizes. Received min=${this.minSize} max=${this.maxSize}`
      );
    }

    if (this.minSize > this.maxSize) {
      throw new Error(
        `GhostTabPoolManager minSize must be <= maxSize. Received min=${this.minSize} max=${this.maxSize}`
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    for (let index = 1; index <= this.maxSize; index += 1) {
      const contextId = `${this.contextIdPrefix}${index}`;
      this.slots.set(contextId, {
        contextId,
        state: "COLD",
        cdpClient: null,
        lastWarmDurationMs: null
      });
    }

    const contextsToWarm = this.getContextIdsByState("COLD").slice(0, this.minSize);
    const warmStart = Date.now();
    for (const contextId of contextsToWarm) {
      await this.warmSlot(contextId);
    }

    this.initialized = true;
    const initDurationMs = Date.now() - warmStart;
    this.logger(
      `[pool] initialized min=${this.minSize} max=${this.maxSize} warmSlots=${contextsToWarm.length} durationMs=${initDurationMs}`
    );
  }

  async acquireGhostTab(options: AcquireGhostTabOptions): Promise<GhostTabLease> {
    this.assertInitialized();
    const taskId = options.taskId?.trim();
    if (!taskId) {
      throw new Error("acquireGhostTab requires a non-empty taskId.");
    }

    const priority = options.priority ?? "BACKGROUND";

    const immediateLease = this.tryAcquireFromAvailable({
      requestedAtMs: Date.now(),
      taskId,
      priority,
      wasQueued: false
    });
    if (immediateLease) {
      return immediateLease;
    }

    return new Promise<GhostTabLease>((resolve, reject) => {
      const request: AcquireRequest = {
        requestedAtMs: Date.now(),
        taskId,
        priority,
        resolve,
        reject
      };

      this.enqueueRequest(request);

      this.logger(
        `[pool] queued taskId=${taskId} priority=${priority} queueDepth=${this.getQueueDepth()}`
      );
      this.ensureReplenishLoop();
    });
  }

  getSnapshot(): GhostTabPoolSnapshot {
    this.assertInitialized();
    const states = [...this.slots.values()];
    const cold = states.filter((slot) => slot.state === "COLD").length;
    const replenishing = states.filter((slot) => slot.state === "REPLENISHING").length;
    const available = states.filter((slot) => slot.state === "AVAILABLE").length;
    const inUse = states.filter((slot) => slot.state === "IN_USE").length;

    return {
      minSize: this.minSize,
      maxSize: this.maxSize,
      totalSlots: states.length,
      cold,
      replenishing,
      available,
      inUse,
      queued: this.getQueueDepth(),
      slotStates: states
        .map((slot) => ({
          contextId: slot.contextId,
          state: slot.state,
          lastWarmDurationMs: slot.lastWarmDurationMs
        }))
        .sort((left, right) => left.contextId.localeCompare(right.contextId))
    };
  }

  getTelemetry(): GhostTabPoolTelemetry {
    this.assertInitialized();
    return {
      warmAssignmentCount: this.warmAssignmentWaits.length,
      queuedAssignmentCount: this.queuedAssignmentWaits.length,
      averageWarmAssignmentWaitMs: round3(mean(this.warmAssignmentWaits)),
      averageQueueWaitMs: round3(mean(this.queuedAssignmentWaits)),
      averageWarmDurationMs: round3(mean(this.warmDurations))
    };
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;

    const pending = [
      ...this.foregroundWaitQueue.splice(0, this.foregroundWaitQueue.length),
      ...this.backgroundWaitQueue.splice(0, this.backgroundWaitQueue.length)
    ];
    for (const request of pending) {
      request.reject(new Error("GhostTabPoolManager shutting down."));
    }

    const uniqueClients = new Set<GhostTabCdpClient>();
    for (const slot of this.slots.values()) {
      if (slot.cdpClient) {
        uniqueClients.add(slot.cdpClient);
      }
      slot.cdpClient = null;
      slot.state = "COLD";
    }
    this.availableContextIds.splice(0, this.availableContextIds.length);
    this.activeLeases.clear();

    await Promise.allSettled(
      [...uniqueClients].map((client) =>
        client.close().catch(() => {
          // best-effort cleanup
        })
      )
    );

    this.replenishLoopPromise = null;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("GhostTabPoolManager.initialize() must complete before use.");
    }
  }

  private tryAcquireFromAvailable(request: {
    requestedAtMs: number;
    taskId: string;
    priority: GhostTabTaskPriority;
    wasQueued: boolean;
  }): GhostTabLease | null {
    const contextId = this.availableContextIds.shift();
    if (!contextId) {
      this.ensureReplenishLoop();
      return null;
    }

    const slot = this.slots.get(contextId);
    if (!slot || !slot.cdpClient || slot.state !== "AVAILABLE") {
      this.ensureReplenishLoop();
      return null;
    }

    slot.state = "IN_USE";

    const waitMs = Date.now() - request.requestedAtMs;
    if (request.wasQueued) {
      this.queuedAssignmentWaits.push(waitMs);
    } else {
      this.warmAssignmentWaits.push(waitMs);
    }

    const leaseId = this.nextLeaseIdString();
    const taskStateMachine = createGhostTabTaskStateMachine({
      taskId: request.taskId,
      contextId,
      onTransition: (event) => {
        this.options.onTaskStateTransition?.(event);
      }
    });
    this.activeLeases.set(leaseId, {
      taskId: request.taskId,
      priority: request.priority,
      wasQueued: request.wasQueued,
      contextId,
      released: false,
      taskStateMachine
    });

    this.logger(
      `[pool] assigned taskId=${request.taskId} context=${contextId} waitMs=${waitMs} available=${this.availableContextIds.length} inUse=${this.countByState("IN_USE")}`
    );
    this.emitQueueStatus({
      eventType: "DISPATCHED",
      taskId: request.taskId,
      priority: request.priority,
      contextId,
      waitMs,
      wasQueued: request.wasQueued
    });

    this.ensureReplenishLoop();

    return {
      leaseId,
      taskId: request.taskId,
      contextId,
      assignmentWaitMs: waitMs,
      cdpClient: slot.cdpClient,
      getTaskState: () => taskStateMachine.getState(),
      getTaskStateHistory: () => taskStateMachine.getTransitionHistory(),
      transitionTaskState: (to, context = {}) => {
        return taskStateMachine.transition(to, context);
      },
      release: async () => {
        await this.releaseLease(leaseId);
      }
    };
  }

  private async releaseLease(leaseId: string): Promise<void> {
    this.assertInitialized();
    const active = this.activeLeases.get(leaseId);
    if (!active || active.released) {
      return;
    }
    active.released = true;
    this.activeLeases.delete(leaseId);

    const stateBeforeRelease = active.taskStateMachine.getState();
    if (stateBeforeRelease !== "IDLE") {
      if (stateBeforeRelease !== "COMPLETE" && stateBeforeRelease !== "FAILED") {
        active.taskStateMachine.transition("FAILED", {
          reason: "LEASE_RELEASED_BEFORE_TERMINAL_STATE",
          errorDetail: createGhostTabTaskErrorDetail({
            error: new Error(
              `Lease ${leaseId} was released while task was still in ${stateBeforeRelease}.`
            )
          })
        });
      }

      if (active.taskStateMachine.getState() !== "IDLE") {
        active.taskStateMachine.transition("IDLE", {
          reason: "LEASE_RELEASED"
        });
      }
    }

    const slot = this.slots.get(active.contextId);
    if (!slot) {
      return;
    }

    if (slot.state !== "IN_USE") {
      return;
    }

    const crashEvent = slot.cdpClient?.getLastCrashEvent() ?? null;
    if (crashEvent) {
      this.emitQueueStatus({
        eventType: "RELEASED",
        taskId: active.taskId,
        priority: active.priority,
        contextId: slot.contextId,
        waitMs: null,
        wasQueued: active.wasQueued
      });
      await this.recycleCrashedSlot(slot, crashEvent.status ?? crashEvent.source);
      this.processQueue();
      this.ensureReplenishLoop();
      return;
    }

    slot.state = "AVAILABLE";
    if (!this.availableContextIds.includes(slot.contextId)) {
      this.availableContextIds.push(slot.contextId);
    }

    this.logger(
      `[pool] released context=${slot.contextId} available=${this.availableContextIds.length} inUse=${this.countByState("IN_USE")}`
    );
    this.emitQueueStatus({
      eventType: "RELEASED",
      taskId: active.taskId,
      priority: active.priority,
      contextId: slot.contextId,
      waitMs: null,
      wasQueued: active.wasQueued
    });

    this.processQueue();
    this.ensureReplenishLoop();
  }

  private async recycleCrashedSlot(slot: PoolSlot, reason: string): Promise<void> {
    const staleClient = slot.cdpClient;
    this.removeFromAvailable(slot.contextId);
    slot.state = "COLD";
    slot.cdpClient = null;
    slot.lastWarmDurationMs = null;
    await staleClient?.close().catch(() => {
      // best-effort cleanup for crashed CDP sessions
    });

    this.logger(`[pool] crash-recovery recycling context=${slot.contextId} reason=${reason}`);
    await this.warmSlot(slot.contextId).catch((error) => {
      this.logger(
        `[pool] crash-recovery warm-failed context=${slot.contextId} error=${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  private ensureReplenishLoop(): void {
    if (!this.initialized) {
      return;
    }

    if (this.replenishLoopPromise) {
      return;
    }

    this.replenishLoopPromise = (async () => {
      try {
        await this.replenishToMinimumAvailable();
      } catch (error) {
        this.logger(
          `[pool] replenish-failed error=${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        this.processQueue();
        this.replenishLoopPromise = null;
        const shouldRunAgain =
          this.initialized &&
          this.availableContextIds.length < this.minSize &&
          this.getContextIdsByState("COLD").length > 0;
        if (shouldRunAgain) {
          this.ensureReplenishLoop();
        }
      }
    })();
  }

  private async replenishToMinimumAvailable(): Promise<void> {
    while (this.availableContextIds.length < this.minSize) {
      const coldContextId = this.getContextIdsByState("COLD")[0];
      if (!coldContextId) {
        return;
      }

      await this.warmSlot(coldContextId);
    }
  }

  private async warmSlot(contextId: string): Promise<void> {
    const slot = this.slots.get(contextId);
    if (!slot) {
      throw new Error(`Unknown slot contextId=${contextId}`);
    }

    if (slot.state === "AVAILABLE" || slot.state === "IN_USE") {
      return;
    }

    if (slot.state === "REPLENISHING") {
      return;
    }

    slot.state = "REPLENISHING";
    const warmStartMs = Date.now();
    const connectOptions: ConnectToGhostTabCdpOptions = {
      endpointURL: this.options.endpointURL,
      connectTimeoutMs: this.connectTimeoutMs,
      targetUrlIncludes: `#ghost-context=${contextId}`
    };

    try {
      const cdpClient = await connectToGhostTabCdp(connectOptions);
      slot.cdpClient = cdpClient;
      slot.state = "AVAILABLE";
      slot.lastWarmDurationMs = Date.now() - warmStartMs;
      this.warmDurations.push(slot.lastWarmDurationMs);
      if (!this.availableContextIds.includes(contextId)) {
        this.availableContextIds.push(contextId);
      }
      this.logger(
        `[pool] warmed context=${contextId} warmMs=${slot.lastWarmDurationMs} available=${this.availableContextIds.length}`
      );
    } catch (error) {
      slot.state = "COLD";
      slot.cdpClient = null;
      slot.lastWarmDurationMs = null;
      throw error;
    }
  }

  private processQueue(): void {
    if (this.getQueueDepth() === 0 || this.availableContextIds.length === 0) {
      return;
    }

    while (this.getQueueDepth() > 0 && this.availableContextIds.length > 0) {
      const request = this.dequeueNextRequest();
      if (!request) {
        break;
      }

      const lease = this.tryAcquireFromAvailable({
        requestedAtMs: request.requestedAtMs,
        taskId: request.taskId,
        priority: request.priority,
        wasQueued: true
      });
      if (!lease) {
        this.requeueFront(request);
        return;
      }

      request.resolve(lease);
    }
  }

  private enqueueRequest(request: AcquireRequest): void {
    if (request.priority === "FOREGROUND") {
      this.foregroundWaitQueue.push(request);
    } else {
      this.backgroundWaitQueue.push(request);
    }

    this.emitQueueStatus({
      eventType: "ENQUEUED",
      taskId: request.taskId,
      priority: request.priority,
      contextId: null,
      waitMs: null,
      wasQueued: true
    });
  }

  private dequeueNextRequest(): AcquireRequest | undefined {
    if (this.foregroundWaitQueue.length > 0) {
      return this.foregroundWaitQueue.shift();
    }

    return this.backgroundWaitQueue.shift();
  }

  private requeueFront(request: AcquireRequest): void {
    if (request.priority === "FOREGROUND") {
      this.foregroundWaitQueue.unshift(request);
      return;
    }

    this.backgroundWaitQueue.unshift(request);
  }

  private getQueueDepth(): number {
    return this.foregroundWaitQueue.length + this.backgroundWaitQueue.length;
  }

  private emitQueueStatus(input: {
    eventType: GhostTabQueueStatusEventType;
    taskId: string;
    priority: GhostTabTaskPriority;
    contextId: string | null;
    waitMs: number | null;
    wasQueued: boolean;
  }): void {
    this.options.onQueueStatus?.({
      eventType: input.eventType,
      taskId: input.taskId,
      priority: input.priority,
      queueDepth: this.getQueueDepth(),
      available: this.countByState("AVAILABLE"),
      inUse: this.countByState("IN_USE"),
      contextId: input.contextId,
      waitMs: input.waitMs,
      wasQueued: input.wasQueued,
      timestamp: new Date().toISOString()
    });
  }

  private getContextIdsByState(state: PoolSlotState): string[] {
    return [...this.slots.values()]
      .filter((slot) => slot.state === state)
      .map((slot) => slot.contextId)
      .sort();
  }

  private removeFromAvailable(contextId: string): void {
    for (let index = this.availableContextIds.length - 1; index >= 0; index -= 1) {
      if (this.availableContextIds[index] === contextId) {
        this.availableContextIds.splice(index, 1);
      }
    }
  }

  private countByState(state: PoolSlotState): number {
    return [...this.slots.values()].filter((slot) => slot.state === state).length;
  }

  private nextLeaseIdString(): string {
    this.nextLeaseId += 1;
    return `lease-${this.nextLeaseId}`;
  }
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function createGhostTabPoolManager(options: GhostTabPoolManagerOptions): GhostTabPoolManager {
  return new GhostTabPoolManager(options);
}
