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

export interface GhostTabPoolManagerOptions {
  endpointURL: string;
  minSize?: number;
  maxSize?: number;
  contextIdPrefix?: string;
  connectTimeoutMs?: number;
  logger?: (line: string) => void;
  onTaskStateTransition?: (event: GhostTabStateTransitionEvent) => void;
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
  private readonly waitQueue: AcquireRequest[] = [];
  private readonly activeLeases = new Map<
    string,
    {
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

      if (request.priority === "FOREGROUND") {
        this.waitQueue.unshift(request);
      } else {
        this.waitQueue.push(request);
      }

      this.logger(
        `[pool] queued taskId=${taskId} priority=${priority} queueDepth=${this.waitQueue.length}`
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
      queued: this.waitQueue.length,
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

    const pending = this.waitQueue.splice(0, this.waitQueue.length);
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

    this.initialized = false;
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
      contextId,
      released: false,
      taskStateMachine
    });

    this.logger(
      `[pool] assigned taskId=${request.taskId} context=${contextId} waitMs=${waitMs} available=${this.availableContextIds.length} inUse=${this.countByState("IN_USE")}`
    );

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

    slot.state = "AVAILABLE";
    if (!this.availableContextIds.includes(slot.contextId)) {
      this.availableContextIds.push(slot.contextId);
    }

    this.logger(
      `[pool] released context=${slot.contextId} available=${this.availableContextIds.length} inUse=${this.countByState("IN_USE")}`
    );

    this.processQueue();
    this.ensureReplenishLoop();
  }

  private ensureReplenishLoop(): void {
    if (this.replenishLoopPromise) {
      return;
    }

    this.replenishLoopPromise = (async () => {
      try {
        await this.replenishToMinimumAvailable();
        this.processQueue();
      } finally {
        this.replenishLoopPromise = null;
        const shouldRunAgain =
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
    if (this.waitQueue.length === 0 || this.availableContextIds.length === 0) {
      return;
    }

    while (this.waitQueue.length > 0 && this.availableContextIds.length > 0) {
      const request = this.waitQueue.shift();
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
        this.waitQueue.unshift(request);
        return;
      }

      request.resolve(lease);
    }
  }

  private getContextIdsByState(state: PoolSlotState): string[] {
    return [...this.slots.values()]
      .filter((slot) => slot.state === state)
      .map((slot) => slot.contextId)
      .sort();
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
