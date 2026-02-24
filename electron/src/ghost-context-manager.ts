import { BrowserView, session, type Session } from "electron";

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
  ghostView: BrowserView;
  status: "ACTIVE" | "DESTROYING";
  destroyPromise: Promise<void> | null;
  readOnlyInputGuards: {
    beforeInput: (event: Event, input: unknown) => void;
    beforeMouse: (event: Event, mouse: unknown) => void;
  };
}

export interface GhostContextManagerOptions {
  contextCount: number;
  autoReplenish: boolean;
  defaultSize?: {
    width: number;
    height: number;
  };
  showGhostTab?: boolean;
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
      const { webContents } = context.ghostView;
      const url = webContents.isDestroyed() ? "about:blank" : safeGetCurrentUrl(webContents);
      summaries.push({
        contextId: context.contextId,
        partition: context.partition,
        webContentsId: webContents.id,
        url,
        status: context.status
      });
    }

    return summaries.sort((left, right) => left.contextId.localeCompare(right.contextId));
  }

  getContextView(contextId: string): BrowserView | null {
    const context = this.contexts.get(contextId);
    if (!context || context.status === "DESTROYING") {
      return null;
    }

    const { ghostView } = context;
    if (ghostView.webContents.isDestroyed()) {
      return null;
    }

    return ghostView;
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

  async captureGhostPage(contextId: string): Promise<string | null> {
    const context = this.contexts.get(contextId);
    if (!context || context.status === "DESTROYING") {
      return null;
    }

    const { webContents } = context.ghostView;
    if (webContents.isDestroyed()) {
      return null;
    }

    try {
      const nativeImage = await webContents.capturePage();
      const pngBuffer = nativeImage.toPNG();
      return pngBuffer.toString("base64");
    } catch {
      return null;
    }
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
    const { contextId, partition, partitionSession, ghostView, readOnlyInputGuards } = context;
    this.logger(`[ghost-context] destroying id=${contextId} partition=${partition}`);

    const { webContents } = ghostView;
    if (!webContents.isDestroyed()) {
      (
        webContents as unknown as {
          removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
        }
      ).removeListener("before-input-event", readOnlyInputGuards.beforeInput as (...args: unknown[]) => void);
      (
        webContents as unknown as {
          removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
        }
      ).removeListener("before-mouse-event", readOnlyInputGuards.beforeMouse as (...args: unknown[]) => void);
      await closeBrowserView(ghostView);
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
    const ghostView = new BrowserView({
      webPreferences: {
        session: partitionSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });

    const beforeInput = (event: Event, input: unknown): void => {
      void input;
      event.preventDefault();
    };
    const beforeMouse = (event: Event, mouse: unknown): void => {
      void mouse;
      event.preventDefault();
    };

    const managedContext: ManagedGhostContext = {
      contextId,
      partition,
      partitionSession,
      ghostView,
      status: "ACTIVE",
      destroyPromise: null,
      readOnlyInputGuards: {
        beforeInput,
        beforeMouse
      }
    };

    this.contexts.set(contextId, managedContext);

    const { webContents } = ghostView;

    (webContents as unknown as { on: (event: string, listener: (...args: unknown[]) => void) => void }).on(
      "before-input-event",
      beforeInput as (...args: unknown[]) => void
    );
    (webContents as unknown as { on: (event: string, listener: (...args: unknown[]) => void) => void }).on(
      "before-mouse-event",
      beforeMouse as (...args: unknown[]) => void
    );

    webContents.on("did-finish-load", () => {
      this.logger(
        `[ghost-context] ready id=${contextId} partition=${partition} webContentsId=${webContents.id} url=${safeGetCurrentUrl(webContents)}`
      );
    });

    webContents.on("did-fail-load", (...args) => {
      const [, errorCode, errorDescription, validatedURL] = args;
      this.logger(
        `[ghost-context] load-failed id=${contextId} url=${validatedURL} code=${String(errorCode)} error=${String(errorDescription)}`
      );
    });

    webContents.on("destroyed", () => {
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
      await webContents.loadURL(initialUrl);
    } catch (error) {
      this.contexts.delete(contextId);
      if (!webContents.isDestroyed()) {
        webContents.close();
      }
      throw error;
    }
  }

  private toContextId(index: number): string {
    return `ctx-${index}`;
  }
}

function safeGetCurrentUrl(webContents: BrowserView["webContents"]): string {
  try {
    return webContents.getURL() || "about:blank";
  } catch {
    return "about:blank";
  }
}

async function closeBrowserView(view: BrowserView): Promise<void> {
  const { webContents } = view;
  if (webContents.isDestroyed()) {
    return;
  }

  await new Promise<void>((resolve) => {
    webContents.once("destroyed", () => {
      resolve();
    });
    webContents.close();
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
