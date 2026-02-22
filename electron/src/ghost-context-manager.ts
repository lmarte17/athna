import { BrowserWindow, session, type Session } from "electron";

const PARTITION_PREFIX = "persist:ghost-";
const STORAGE_TYPES_TO_CLEAR = [
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "serviceworkers",
  "shadercache",
  "websql",
  "cachestorage"
] as const;

interface WindowSize {
  width: number;
  height: number;
}

export interface GhostContextSummary {
  contextId: string;
  partition: string;
  webContentsId: number;
  url: string;
  status: "ACTIVE" | "DESTROYING";
}

interface ManagedGhostContext {
  contextId: string;
  partition: string;
  partitionSession: Session;
  ghostWindow: BrowserWindow;
  status: "ACTIVE" | "DESTROYING";
  destroyPromise: Promise<void> | null;
}

export interface GhostContextManagerOptions {
  contextCount: number;
  autoReplenish: boolean;
  defaultSize: WindowSize;
  showGhostTab: boolean;
  initialUrlForContext: (contextId: string) => string;
  logger?: (line: string) => void;
}

export class GhostContextManager {
  private readonly contexts = new Map<string, ManagedGhostContext>();
  private readonly desiredContextIds: string[];
  private readonly logger: (line: string) => void;
  private shuttingDown = false;

  constructor(private readonly options: GhostContextManagerOptions) {
    if (!Number.isFinite(options.contextCount) || options.contextCount <= 0) {
      throw new Error(`contextCount must be a positive integer. Received: ${options.contextCount}`);
    }

    this.desiredContextIds = Array.from({ length: options.contextCount }, (_, index) => {
      return this.toContextId(index + 1);
    });
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  async initialize(): Promise<void> {
    for (const contextId of this.desiredContextIds) {
      await this.createContext(contextId);
    }
  }

  listContexts(): GhostContextSummary[] {
    const summaries: GhostContextSummary[] = [];
    for (const context of this.contexts.values()) {
      const url = context.ghostWindow.isDestroyed() ? "about:blank" : context.ghostWindow.webContents.getURL();
      summaries.push({
        contextId: context.contextId,
        partition: context.partition,
        webContentsId: context.ghostWindow.webContents.id,
        url,
        status: context.status
      });
    }

    return summaries.sort((left, right) => left.contextId.localeCompare(right.contextId));
  }

  async destroyContext(contextId: string, allowReplenish = true): Promise<void> {
    const context = this.contexts.get(contextId);
    if (!context) {
      return;
    }

    if (context.destroyPromise) {
      await context.destroyPromise;
      return;
    }

    context.status = "DESTROYING";
    context.destroyPromise = this.destroyContextInternal(context, allowReplenish).finally(() => {
      context.destroyPromise = null;
    });

    await context.destroyPromise;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const activeContextIds = [...this.contexts.keys()];
    await Promise.all(activeContextIds.map((contextId) => this.destroyContext(contextId, false)));
  }

  private async destroyContextInternal(
    context: ManagedGhostContext,
    allowReplenish: boolean
  ): Promise<void> {
    const { contextId, partition, partitionSession, ghostWindow } = context;
    this.logger(`[ghost-context] destroying id=${contextId} partition=${partition}`);

    if (!ghostWindow.isDestroyed()) {
      await closeBrowserWindow(ghostWindow);
    }

    await clearPartitionStorage(partitionSession, contextId);
    this.contexts.delete(contextId);

    this.logger(`[ghost-context] destroyed id=${contextId} partition=${partition}`);

    const shouldReplenish =
      allowReplenish &&
      this.options.autoReplenish &&
      !this.shuttingDown &&
      this.desiredContextIds.includes(contextId);
    if (shouldReplenish) {
      this.logger(`[ghost-context] replenishing id=${contextId}`);
      await this.createContext(contextId);
    }
  }

  private async createContext(contextId: string): Promise<void> {
    if (this.contexts.has(contextId)) {
      return;
    }

    const partition = `${PARTITION_PREFIX}${contextId}`;
    const partitionSession = session.fromPartition(partition, {
      cache: true
    });
    const initialUrl = this.options.initialUrlForContext(contextId);
    const ghostWindow = new BrowserWindow({
      width: this.options.defaultSize.width,
      height: this.options.defaultSize.height,
      show: this.options.showGhostTab,
      webPreferences: this.options.showGhostTab
        ? {
            session: partitionSession
          }
        : {
            session: partitionSession,
            offscreen: true
          }
    });

    const managedContext: ManagedGhostContext = {
      contextId,
      partition,
      partitionSession,
      ghostWindow,
      status: "ACTIVE",
      destroyPromise: null
    };

    this.contexts.set(contextId, managedContext);

    ghostWindow.webContents.on("did-finish-load", () => {
      this.logger(
        `[ghost-context] ready id=${contextId} partition=${partition} webContentsId=${ghostWindow.webContents.id} url=${ghostWindow.webContents.getURL()}`
      );
    });

    ghostWindow.webContents.on("did-fail-load", (...args) => {
      const [, errorCode, errorDescription, validatedURL] = args;
      this.logger(
        `[ghost-context] load-failed id=${contextId} url=${validatedURL} code=${String(errorCode)} error=${String(errorDescription)}`
      );
    });

    ghostWindow.on("closed", () => {
      const latest = this.contexts.get(contextId);
      if (!latest) {
        return;
      }

      if (latest.status === "DESTROYING") {
        return;
      }

      void this.destroyContext(contextId);
    });

    try {
      await ghostWindow.loadURL(initialUrl);
    } catch (error) {
      this.contexts.delete(contextId);
      if (!ghostWindow.isDestroyed()) {
        ghostWindow.destroy();
      }
      throw error;
    }
  }

  private toContextId(index: number): string {
    return `ctx-${index}`;
  }
}

async function closeBrowserWindow(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) {
    return;
  }

  await new Promise<void>((resolve) => {
    window.once("closed", () => {
      resolve();
    });
    window.close();
  });
}

async function clearPartitionStorage(partitionSession: Session, contextId: string): Promise<void> {
  const clearStorageDataPromise = partitionSession.clearStorageData({
    storages: [...STORAGE_TYPES_TO_CLEAR]
  });
  const clearCachePromise = partitionSession.clearCache();
  const clearAuthCachePromise = partitionSession.clearAuthCache();

  const clearResults = await Promise.allSettled([
    clearStorageDataPromise,
    clearCachePromise,
    clearAuthCachePromise
  ]);
  const rejected = clearResults.filter((result): result is PromiseRejectedResult => {
    return result.status === "rejected";
  });

  if (rejected.length > 0) {
    const errorSummary = rejected.map((result) => String(result.reason)).join("; ");
    throw new Error(
      `[ghost-context] failed clearing storage for ${contextId}: ${errorSummary}`
    );
  }

  const remainingCookies = await partitionSession.cookies.get({});
  if (remainingCookies.length > 0) {
    throw new Error(
      `[ghost-context] storage clear incomplete for ${contextId}: ${remainingCookies.length} cookie(s) remain`
    );
  }
}
