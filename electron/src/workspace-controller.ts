import { randomUUID } from "node:crypto";

import {
  BrowserView,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  type IpcMainInvokeEvent,
  type Input
} from "electron";

import {
  COMMAND_MODES,
  type CommandDispatchRecord,
  type CommandMode,
  type WorkspaceTaskSummary,
  type WorkspaceCommandSubmission,
  type WorkspaceCommandSubmissionResult,
  type WorkspaceState,
  type WorkspaceTabState,
  WORKSPACE_CHANNELS
} from "./workspace-types.js";
import { buildExecutionPlan, classifyCommandIntent } from "./intent-classifier.js";
import {
  OrchestrationRuntime,
  type OrchestrationStatusMessage,
  type RuntimeTaskResult
} from "./orchestration-runtime.js";

const START_PAGE_TAB_ID = "start-page";
const DEFAULT_NEW_TAB_TITLE = "New Page";
const DEFAULT_NEW_TAB_URL = "about:blank";
const DEFAULT_TASK_START_URL = "https://www.google.com/";
const DEFAULT_TOP_CHROME_HEIGHT = 132;
const MAX_TAB_TITLE_LENGTH = 64;
const DEFAULT_NEW_TAB_HOST_LABEL = "New";
const COMMAND_FOCUS_ACCELERATOR = "CommandOrControl+L";
const STATE_EVENT_MAX_HZ = 2;
const STATE_EMIT_WINDOW_MS = 1000;
const MAX_STATE_EMITS_PER_WINDOW = STATE_EVENT_MAX_HZ;

interface WorkspaceControllerOptions {
  window: BrowserWindow;
  remoteDebuggingPort: string;
  topChromeHeight?: number;
  ghostPageCapturer?: (contextId: string) => Promise<string | null>;
  ghostContextDestroyer?: (contextId: string) => Promise<void>;
  logger?: (line: string) => void;
}

interface WorkspaceTabInternal {
  id: string;
  title: string;
  kind: "START" | "WEB";
  url: string;
  loading: boolean;
  canClose: boolean;
  view: BrowserView | null;
}

interface CommandDispatchContext {
  source: WorkspaceCommandSubmission["source"];
  mode: CommandMode;
  rawInput: string;
  workspaceContextId: string;
  normalizedUrl: string | null;
  classification: CommandDispatchRecord["classification"];
  executionPlan: CommandDispatchRecord["executionPlan"];
  taskId: string | null;
}

interface ManagedWorkspaceTask {
  taskId: string;
  workspaceContextId: string;
  intent: WorkspaceTaskSummary["intent"];
  route: WorkspaceTaskSummary["route"];
  status: WorkspaceTaskSummary["status"];
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
  ghostContextId: string | null;
}

export class WorkspaceController {
  private readonly window: BrowserWindow;
  private readonly topChromeHeight: number;
  private readonly logger: (line: string) => void;
  private readonly remoteDebuggingPort: string;
  private readonly ghostPageCapturer: ((contextId: string) => Promise<string | null>) | undefined;
  private readonly ghostContextDestroyer: ((contextId: string) => Promise<void>) | undefined;
  private readonly tabs = new Map<string, WorkspaceTabInternal>();
  private readonly tabOrder: string[] = [];
  private readonly tasks = new Map<string, ManagedWorkspaceTask>();
  private readonly taskOrder: string[] = [];
  private readonly orchestrationRuntime: OrchestrationRuntime;
  private readonly onWindowResize = (): void => {
    this.layoutActiveView();
  };
  private readonly onShortcutBeforeInput = (
    event: {
      preventDefault: () => void;
    },
    input: Input
  ): void => {
    if (isFocusCommandShortcut(input)) {
      event.preventDefault();
      this.requestCommandFocus();
    }
  };
  private readonly handleGetState = async (event: IpcMainInvokeEvent): Promise<WorkspaceState> => {
    this.assertInvokeSender(event);
    return this.serializeState();
  };
  private readonly handleCreateTab = async (event: IpcMainInvokeEvent): Promise<WorkspaceState> => {
    this.assertInvokeSender(event);
    const tab = this.createWebTab();
    this.setActiveTab(tab.id);
    this.emitState();
    this.requestCommandFocus();
    return this.serializeState();
  };
  private readonly handleSwitchTab = async (
    event: IpcMainInvokeEvent,
    tabId: string
  ): Promise<WorkspaceState> => {
    this.assertInvokeSender(event);
    this.setActiveTab(tabId);
    this.emitState();
    return this.serializeState();
  };
  private readonly handleCloseTab = async (
    event: IpcMainInvokeEvent,
    tabId: string
  ): Promise<WorkspaceState> => {
    this.assertInvokeSender(event);
    this.closeTab(tabId);
    this.emitState();
    return this.serializeState();
  };
  private readonly handleSubmitCommand = async (
    event: IpcMainInvokeEvent,
    rawSubmission: WorkspaceCommandSubmission
  ): Promise<WorkspaceCommandSubmissionResult> => {
    this.assertInvokeSender(event);
    const result = this.submitCommand(rawSubmission);
    this.emitState();
    return result;
  };
  private readonly handleGetTaskScreenshot = async (
    event: IpcMainInvokeEvent,
    taskId: string
  ): Promise<string | null> => {
    this.assertInvokeSender(event);
    const ghostContextId = this.getTaskGhostContextId(taskId);
    if (!ghostContextId || !this.ghostPageCapturer) {
      return null;
    }
    return this.ghostPageCapturer(ghostContextId);
  };
  private readonly handleCancelTask = async (
    event: IpcMainInvokeEvent,
    taskId: string
  ): Promise<{ cancelled: boolean }> => {
    this.assertInvokeSender(event);
    const cancelled = await this.cancelTask(taskId);
    this.emitState();
    return { cancelled };
  };

  private nextTabOrdinal = 1;
  private activeTabId = START_PAGE_TAB_ID;
  private attachedViewTabId: string | null = null;
  private initialized = false;
  private lastDispatch: CommandDispatchRecord | null = null;
  private focusShortcutRegistered = false;
  private pendingStateEmitTimer: NodeJS.Timeout | null = null;
  private readonly stateEmitTimestamps: number[] = [];

  constructor(options: WorkspaceControllerOptions) {
    this.window = options.window;
    if (this.window.getMaxListeners() < 64) {
      this.window.setMaxListeners(64);
    }
    this.topChromeHeight = options.topChromeHeight ?? DEFAULT_TOP_CHROME_HEIGHT;
    this.logger = options.logger ?? ((line: string) => console.info(line));
    this.remoteDebuggingPort = options.remoteDebuggingPort;
    this.ghostPageCapturer = options.ghostPageCapturer;
    this.ghostContextDestroyer = options.ghostContextDestroyer;
    this.orchestrationRuntime = new OrchestrationRuntime({
      remoteDebuggingPort: this.remoteDebuggingPort,
      logger: (line) => this.logger(line),
      onStatusMessage: (message) => {
        this.applyRuntimeStatusMessage(message);
      }
    });
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.ensureStartPageTab();

    this.window.on("resize", this.onWindowResize);
    this.window.webContents.on("before-input-event", this.onShortcutBeforeInput);
    this.registerFocusShortcut();

    ipcMain.handle(WORKSPACE_CHANNELS.getState, this.handleGetState);
    ipcMain.handle(WORKSPACE_CHANNELS.createTab, this.handleCreateTab);
    ipcMain.handle(WORKSPACE_CHANNELS.switchTab, this.handleSwitchTab);
    ipcMain.handle(WORKSPACE_CHANNELS.closeTab, this.handleCloseTab);
    ipcMain.handle(WORKSPACE_CHANNELS.submitCommand, this.handleSubmitCommand);
    ipcMain.handle(WORKSPACE_CHANNELS.getTaskScreenshot, this.handleGetTaskScreenshot);
    ipcMain.handle(WORKSPACE_CHANNELS.cancelTask, this.handleCancelTask);
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;

    ipcMain.removeHandler(WORKSPACE_CHANNELS.getState);
    ipcMain.removeHandler(WORKSPACE_CHANNELS.createTab);
    ipcMain.removeHandler(WORKSPACE_CHANNELS.switchTab);
    ipcMain.removeHandler(WORKSPACE_CHANNELS.closeTab);
    ipcMain.removeHandler(WORKSPACE_CHANNELS.submitCommand);
    ipcMain.removeHandler(WORKSPACE_CHANNELS.getTaskScreenshot);
    ipcMain.removeHandler(WORKSPACE_CHANNELS.cancelTask);

    this.window.removeListener("resize", this.onWindowResize);
    this.window.webContents.removeListener("before-input-event", this.onShortcutBeforeInput);
    this.unregisterFocusShortcut();

    this.detachActiveView();
    const tabsToDestroy = [...this.tabs.values()];
    this.tabs.clear();
    this.tabOrder.splice(0, this.tabOrder.length);
    this.tasks.clear();
    this.taskOrder.splice(0, this.taskOrder.length);
    if (this.pendingStateEmitTimer) {
      clearTimeout(this.pendingStateEmitTimer);
      this.pendingStateEmitTimer = null;
    }
    this.stateEmitTimestamps.splice(0, this.stateEmitTimestamps.length);

    for (const tab of tabsToDestroy) {
      this.destroyTabView(tab);
    }

    await this.orchestrationRuntime.shutdown();
  }

  emitState(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    this.scheduleStateEmit();
  }

  getTaskGhostContextId(taskId: string): string | null {
    return this.tasks.get(taskId)?.ghostContextId ?? null;
  }

  private scheduleStateEmit(): void {
    const now = Date.now();
    this.pruneStateEmitHistory(now);

    if (this.stateEmitTimestamps.length < MAX_STATE_EMITS_PER_WINDOW) {
      this.flushStateEmit(now);
      return;
    }

    if (this.pendingStateEmitTimer) {
      return;
    }

    const earliestAllowed = this.stateEmitTimestamps[0] + STATE_EMIT_WINDOW_MS + 1;
    const delay = Math.max(1, earliestAllowed - now);
    this.pendingStateEmitTimer = setTimeout(() => {
      this.pendingStateEmitTimer = null;
      this.scheduleStateEmit();
    }, delay);
  }

  private flushStateEmit(emittedAt = Date.now()): void {
    if (this.window.isDestroyed()) {
      return;
    }
    this.stateEmitTimestamps.push(emittedAt);
    this.pruneStateEmitHistory(emittedAt);
    this.window.webContents.send(WORKSPACE_CHANNELS.stateEvent, this.serializeState());
  }

  private pruneStateEmitHistory(referenceTime: number): void {
    while (
      this.stateEmitTimestamps.length > 0 &&
      referenceTime - this.stateEmitTimestamps[0] >= STATE_EMIT_WINDOW_MS
    ) {
      this.stateEmitTimestamps.shift();
    }
  }

  private submitCommand(rawSubmission: WorkspaceCommandSubmission): WorkspaceCommandSubmissionResult {
    const normalizedMode = normalizeCommandMode(rawSubmission.mode);
    const normalizedText = rawSubmission.text?.trim() ?? "";
    const source = rawSubmission.source;

    if (!normalizedText) {
      return {
        accepted: false,
        clearInput: false,
        error: "Command is empty.",
        dispatch: null
      };
    }

    const modeOverride = normalizedMode === "AUTO" ? null : normalizedMode;
    const classified = classifyCommandIntent({
      text: normalizedText,
      modeOverride
    });
    const executionPlan = buildExecutionPlan(classified.classification.intent);
    const contextTab = this.ensureActiveWebContextTab();
    let taskId: string | null = null;
    if (classified.classification.intent === "NAVIGATE" && classified.normalizedUrl) {
      this.queueNavigation(contextTab, classified.normalizedUrl);
    } else {
      taskId = this.enqueueRuntimeTask({
        workspaceContextId: contextTab.id,
        intent: classified.classification.intent,
        route: executionPlan.route,
        rawInput: normalizedText,
        startUrl: this.resolveTaskStartUrl({
          activeTab: contextTab,
          classifiedUrl: classified.normalizedUrl
        })
      });
    }

    const dispatch = this.recordCommandDispatch({
      source,
      mode: normalizedMode,
      rawInput: normalizedText,
      workspaceContextId: contextTab.id,
      normalizedUrl: classified.normalizedUrl,
      classification: classified.classification,
      executionPlan,
      taskId
    });
    this.logger(
      `[workspace] dispatch intent=${classified.classification.intent} route=${executionPlan.route} tab=${contextTab.id} mode=${normalizedMode} source=${source}`
    );

    return {
      accepted: true,
      clearInput: true,
      error: null,
      dispatch
    };
  }

  private recordCommandDispatch(context: CommandDispatchContext): CommandDispatchRecord {
    const record: CommandDispatchRecord = {
      dispatchId: randomUUID(),
      submittedAt: new Date().toISOString(),
      source: context.source,
      mode: context.mode,
      modeOverride: context.mode === "AUTO" ? null : context.mode,
      workspaceContextId: context.workspaceContextId,
      rawInput: context.rawInput,
      normalizedUrl: context.normalizedUrl,
      classification: context.classification,
      executionPlan: context.executionPlan,
      taskId: context.taskId
    };
    this.lastDispatch = record;
    return record;
  }

  private enqueueRuntimeTask(input: {
    workspaceContextId: string;
    intent: ManagedWorkspaceTask["intent"];
    route: ManagedWorkspaceTask["route"];
    rawInput: string;
    startUrl: string;
  }): string {
    const taskId = `task-${randomUUID()}`;
    const task: ManagedWorkspaceTask = {
      taskId,
      workspaceContextId: input.workspaceContextId,
      intent: input.intent,
      route: input.route,
      status: "QUEUED",
      rawInput: input.rawInput,
      startUrl: input.startUrl,
      currentUrl: null,
      currentState: "QUEUED",
      currentAction: "Queued for scheduling",
      progressLabel: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      finalUrl: null,
      ghostContextId: null
    };
    this.tasks.set(taskId, task);
    this.taskOrder.unshift(taskId);

    void this.orchestrationRuntime
      .submitTask({
        taskId,
        input: {
          intentText: input.rawInput,
          intentKind: input.intent,
          route: input.route,
          startUrl: input.startUrl,
          workspaceContextId: input.workspaceContextId
        }
      })
      .then((result) => {
        this.finalizeRuntimeTask(taskId, result);
      })
      .catch((error: unknown) => {
        this.failRuntimeTask(taskId, error);
      });

    return taskId;
  }

  private resolveTaskStartUrl(input: {
    activeTab: WorkspaceTabInternal;
    classifiedUrl: string | null;
  }): string {
    if (input.classifiedUrl) {
      return input.classifiedUrl;
    }

    const activeUrl = input.activeTab.url;
    if (isHttpUrl(activeUrl)) {
      return activeUrl;
    }

    return DEFAULT_TASK_START_URL;
  }

  private applyRuntimeStatusMessage(message: OrchestrationStatusMessage): void {
    const task = this.tasks.get(message.taskId);
    if (!task) {
      return;
    }

    // If already cancelled, capture the contextId for deferred destroy
    // (handles the QUEUED→DISPATCHED race where cancel was called before
    // the first status message arrived), then bail out.
    if (task.status === "CANCELLED") {
      if (!task.ghostContextId && message.contextId) {
        task.ghostContextId = message.contextId;
        if (this.ghostContextDestroyer) {
          void this.ghostContextDestroyer(message.contextId).catch((error: unknown) => {
            this.logger(
              `[workspace] deferred-cancel destroy-failed taskId=${message.taskId} error=${
                error instanceof Error ? error.message : String(error)
              }`
            );
          });
        }
      }
      return;
    }

    if (!task.ghostContextId && message.contextId) {
      task.ghostContextId = message.contextId;
    }

    switch (message.payload.kind) {
      case "QUEUE": {
        task.currentState = `QUEUE_${message.payload.event}`;
        task.currentAction = describeQueueEvent(message.payload.event);
        if (message.payload.event === "DISPATCHED") {
          task.status = "RUNNING";
          task.startedAt = task.startedAt ?? new Date().toISOString();
        }
        break;
      }
      case "STATE": {
        task.currentState = message.payload.to;
        task.currentAction = describeRuntimeState(message.payload.to);
        if (message.payload.url) {
          task.currentUrl = message.payload.url;
        }
        if (
          message.payload.to === "LOADING" ||
          message.payload.to === "PERCEIVING" ||
          message.payload.to === "INFERRING" ||
          message.payload.to === "ACTING"
        ) {
          task.status = "RUNNING";
          task.startedAt = task.startedAt ?? new Date().toISOString();
        }
        break;
      }
      case "SCHEDULER": {
        task.currentState = `SCHEDULER_${message.payload.event}`;
        task.currentAction = describeSchedulerEvent(message.payload.event);
        if (message.payload.event === "STARTED") {
          task.status = "RUNNING";
          task.startedAt = task.startedAt ?? new Date().toISOString();
        }
        if (message.payload.event === "FAILED") {
          task.status = "FAILED";
          task.errorMessage = message.payload.error?.message ?? task.errorMessage;
        }
        break;
      }
      case "SUBTASK": {
        task.progressLabel = `Subtask ${message.payload.currentSubtaskIndex + 1}/${message.payload.totalSubtasks} ${message.payload.status.toLowerCase()}`;
        task.currentState = "SUBTASK";
        task.currentAction = describeSubtaskAction(message.payload);
        break;
      }
      default: {
        const unknownPayload: never = message.payload;
        this.logger(`[workspace] unknown runtime status payload: ${String(unknownPayload)}`);
      }
    }

    this.emitState();
  }

  private finalizeRuntimeTask(taskId: string, result: RuntimeTaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    // Do not overwrite a CANCELLED terminal state.
    if (task.status === "CANCELLED") {
      return;
    }

    task.status = result.status === "DONE" ? "SUCCEEDED" : "FAILED";
    task.currentState = result.status;
    task.currentAction =
      result.status === "DONE" ? "Completed execution" : "Task failed during execution";
    task.finishedAt = new Date().toISOString();
    task.durationMs = result.durationMs;
    task.finalUrl = result.finalUrl;
    task.currentUrl = result.finalUrl ?? task.currentUrl;
    task.errorMessage = result.errorMessage;
    this.emitState();
  }

  private failRuntimeTask(taskId: string, error: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    // Do not overwrite a CANCELLED terminal state. The error is expected —
    // it is the result of destroying the BrowserContext on cancellation.
    if (task.status === "CANCELLED") {
      return;
    }

    task.status = "FAILED";
    task.currentState = "FAILED";
    task.currentAction = "Task failed";
    task.finishedAt = new Date().toISOString();
    task.errorMessage = error instanceof Error ? error.message : String(error);
    this.emitState();
  }

  private async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.status !== "QUEUED" && task.status !== "RUNNING") {
      return false;
    }

    // Freeze partial result state before mutating status.
    // currentUrl, currentState, currentAction, and progressLabel are left as-is —
    // they represent the partial result snapshot available to the user.
    task.status = "CANCELLED";
    task.finishedAt = new Date().toISOString();
    task.durationMs = task.startedAt ? Date.now() - Date.parse(task.startedAt) : null;

    this.logger(`[workspace] cancel taskId=${taskId} ghostContextId=${task.ghostContextId ?? "none"}`);

    // Destroy the ghost BrowserContext immediately if one is assigned.
    // This closes the BrowserWindow, causing every in-flight CDP call to throw,
    // which cascades to failRuntimeTask() — which then silently returns due to
    // the CANCELLED guard above.
    if (task.ghostContextId && this.ghostContextDestroyer) {
      await this.ghostContextDestroyer(task.ghostContextId).catch((error: unknown) => {
        this.logger(
          `[workspace] cancel destroy-failed taskId=${taskId} error=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }

    return true;
  }

  private ensureStartPageTab(): void {
    if (this.tabs.has(START_PAGE_TAB_ID)) {
      return;
    }

    const startPageTab: WorkspaceTabInternal = {
      id: START_PAGE_TAB_ID,
      title: "Start Page",
      kind: "START",
      url: "about:start-page",
      loading: false,
      canClose: false,
      view: null
    };

    this.tabs.set(startPageTab.id, startPageTab);
    this.tabOrder.push(startPageTab.id);
    this.activeTabId = startPageTab.id;
  }

  private createWebTab(initialUrl = DEFAULT_NEW_TAB_URL): WorkspaceTabInternal {
    const tabId = `tab-${this.nextTabOrdinal}`;
    this.nextTabOrdinal += 1;

    const tab: WorkspaceTabInternal = {
      id: tabId,
      title: `${DEFAULT_NEW_TAB_HOST_LABEL} ${this.nextTabOrdinal - 1}`,
      kind: "WEB",
      url: initialUrl,
      loading: false,
      canClose: true,
      view: new BrowserView({
        webPreferences: {
          partition: `persist:workspace-${tabId}`,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false
        }
      })
    };

    this.bindTabViewEvents(tab);
    this.tabs.set(tab.id, tab);
    this.tabOrder.push(tab.id);
    this.queueNavigation(tab, initialUrl);

    return tab;
  }

  private bindTabViewEvents(tab: WorkspaceTabInternal): void {
    if (!tab.view) {
      return;
    }

    const { webContents } = tab.view;
    webContents.on("before-input-event", this.onShortcutBeforeInput);
    webContents.on("did-start-loading", () => {
      tab.loading = true;
      this.emitState();
    });
    webContents.on("did-stop-loading", () => {
      tab.loading = false;
      tab.url = safeGetCurrentUrl(webContents, tab.url);
      tab.title = resolveTabTitle({
        currentTitle: webContents.getTitle(),
        currentUrl: tab.url,
        fallback: tab.title
      });
      this.emitState();
    });
    webContents.on("did-navigate", (_event, url) => {
      tab.url = url;
      tab.title = resolveTabTitle({
        currentTitle: webContents.getTitle(),
        currentUrl: tab.url,
        fallback: tab.title
      });
      this.emitState();
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      tab.url = url;
      tab.title = resolveTabTitle({
        currentTitle: webContents.getTitle(),
        currentUrl: tab.url,
        fallback: tab.title
      });
      this.emitState();
    });
    webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      tab.title = resolveTabTitle({
        currentTitle: webContents.getTitle(),
        currentUrl: tab.url,
        fallback: tab.title
      });
      this.emitState();
    });
    webContents.setWindowOpenHandler((details) => {
      this.queueNavigation(tab, details.url);
      return { action: "deny" };
    });
  }

  private queueNavigation(tab: WorkspaceTabInternal, url: string): void {
    if (tab.kind !== "WEB" || !tab.view) {
      return;
    }

    tab.loading = true;
    tab.url = url;
    this.emitState();

    void tab.view.webContents.loadURL(url).catch((error: unknown) => {
      tab.loading = false;
      this.logger(
        `[workspace] navigation-failed tab=${tab.id} url=${url} error=${error instanceof Error ? error.message : String(error)}`
      );
      this.emitState();
    });
  }

  private setActiveTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    this.activeTabId = tabId;
    this.detachActiveView();

    if (tab.kind === "WEB" && tab.view) {
      this.window.addBrowserView(tab.view);
      this.attachedViewTabId = tabId;
      this.layoutActiveView();
      tab.view.webContents.focus();
    }
  }

  private closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.kind === "START") {
      return;
    }

    const tabIndex = this.tabOrder.indexOf(tabId);
    if (tabIndex >= 0) {
      this.tabOrder.splice(tabIndex, 1);
    }
    this.tabs.delete(tabId);

    const wasActive = this.activeTabId === tabId;
    if (wasActive) {
      const fallbackTabId = this.tabOrder[Math.max(0, tabIndex - 1)] ?? START_PAGE_TAB_ID;
      this.setActiveTab(fallbackTabId);
    } else if (this.attachedViewTabId === tabId) {
      this.detachActiveView();
    }

    this.destroyTabView(tab);
  }

  private destroyTabView(tab: WorkspaceTabInternal): void {
    if (!tab.view) {
      return;
    }

    const { webContents } = tab.view;
    webContents.removeListener("before-input-event", this.onShortcutBeforeInput);
    if (!webContents.isDestroyed()) {
      webContents.close();
    }
    tab.view = null;
  }

  private ensureActiveWebContextTab(): WorkspaceTabInternal {
    const active = this.tabs.get(this.activeTabId);
    if (active && active.kind === "WEB") {
      return active;
    }

    const created = this.createWebTab();
    this.setActiveTab(created.id);
    return created;
  }

  private detachActiveView(): void {
    if (!this.attachedViewTabId) {
      return;
    }

    const attachedTab = this.tabs.get(this.attachedViewTabId);
    if (attachedTab?.view) {
      this.window.removeBrowserView(attachedTab.view);
    }
    this.attachedViewTabId = null;
  }

  private layoutActiveView(): void {
    if (!this.attachedViewTabId) {
      return;
    }
    const tab = this.tabs.get(this.attachedViewTabId);
    if (!tab?.view) {
      return;
    }

    const [width, height] = this.window.getContentSize();
    const boundedHeight = Math.max(0, height - this.topChromeHeight);
    tab.view.setBounds({
      x: 0,
      y: this.topChromeHeight,
      width: Math.max(0, width),
      height: boundedHeight
    });
    tab.view.setAutoResize({
      width: true,
      height: true
    });
  }

  private assertInvokeSender(event: IpcMainInvokeEvent): void {
    if (!this.initialized) {
      throw new Error("WorkspaceController is not initialized.");
    }

    if (event.sender.id !== this.window.webContents.id) {
      throw new Error("Rejected workspace IPC from unexpected sender.");
    }
  }

  private requestCommandFocus(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.focus();
    this.window.webContents.send(WORKSPACE_CHANNELS.focusEvent, {
      target: "TOP_BAR"
    });
  }

  private registerFocusShortcut(): void {
    if (this.focusShortcutRegistered) {
      return;
    }

    const registered = globalShortcut.register(COMMAND_FOCUS_ACCELERATOR, () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (!focusedWindow || focusedWindow.id !== this.window.id) {
        return;
      }
      this.requestCommandFocus();
    });

    this.focusShortcutRegistered = registered;
    if (!registered) {
      this.logger(`[workspace] failed to register shortcut ${COMMAND_FOCUS_ACCELERATOR}`);
    }
  }

  private unregisterFocusShortcut(): void {
    if (!this.focusShortcutRegistered) {
      return;
    }
    globalShortcut.unregister(COMMAND_FOCUS_ACCELERATOR);
    this.focusShortcutRegistered = false;
  }

  private serializeState(): WorkspaceState {
    const tabs: WorkspaceTabState[] = this.tabOrder
      .map((tabId) => this.tabs.get(tabId))
      .filter((tab): tab is WorkspaceTabInternal => Boolean(tab))
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        kind: tab.kind,
        url: tab.url,
        loading: tab.loading,
        canClose: tab.canClose
      }));

    const activeTab = this.tabs.get(this.activeTabId);
    const tasks: WorkspaceTaskSummary[] = this.taskOrder
      .map((taskId) => this.tasks.get(taskId))
      .filter((task): task is ManagedWorkspaceTask => Boolean(task))
      .map((task) => ({
        taskId: task.taskId,
        workspaceContextId: task.workspaceContextId,
        intent: task.intent,
        route: task.route,
        status: task.status,
        rawInput: task.rawInput,
        startUrl: task.startUrl,
        currentUrl: task.currentUrl,
        currentState: task.currentState,
        currentAction: task.currentAction,
        progressLabel: task.progressLabel,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        durationMs: task.durationMs,
        finalUrl: task.finalUrl
      }));

    return {
      tabs,
      activeTabId: this.activeTabId,
      isStartPageActive: activeTab?.kind !== "WEB",
      lastDispatch: this.lastDispatch,
      tasks
    };
  }
}

function safeGetCurrentUrl(
  webContents: BrowserView["webContents"],
  fallback: string
): string {
  try {
    return webContents.getURL() || fallback;
  } catch {
    return fallback;
  }
}

function normalizeCommandMode(rawMode: string): CommandMode {
  const candidate = rawMode?.trim().toUpperCase() ?? "AUTO";
  return COMMAND_MODES.includes(candidate as CommandMode) ? (candidate as CommandMode) : "AUTO";
}

function resolveTabTitle(input: {
  currentTitle: string;
  currentUrl: string;
  fallback: string;
}): string {
  const candidateTitle = input.currentTitle?.trim();
  if (candidateTitle) {
    return clipTitle(candidateTitle);
  }

  const hostLabel = resolveHostLabel(input.currentUrl);
  if (hostLabel) {
    return clipTitle(hostLabel);
  }

  return clipTitle(input.fallback || DEFAULT_NEW_TAB_TITLE);
}

function clipTitle(title: string): string {
  if (title.length <= MAX_TAB_TITLE_LENGTH) {
    return title;
  }
  return `${title.slice(0, MAX_TAB_TITLE_LENGTH - 1)}\u2026`;
}

function resolveHostLabel(url: string): string | null {
  if (!url || url === DEFAULT_NEW_TAB_URL) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.host || parsed.hostname || null;
  } catch {
    return null;
  }
}

function isFocusCommandShortcut(input: Input): boolean {
  if (input.type !== "keyDown") {
    return false;
  }

  const normalizedKey = (input.key ?? "").toLowerCase();
  if (normalizedKey !== "l") {
    return false;
  }

  const usesPrimaryModifier = process.platform === "darwin" ? input.meta : input.control;
  return Boolean(usesPrimaryModifier) && !input.alt && !input.shift;
}

function describeQueueEvent(event: "ENQUEUED" | "DISPATCHED" | "RELEASED"): string {
  switch (event) {
    case "ENQUEUED":
      return "Queued in scheduler";
    case "DISPATCHED":
      return "Assigned to Ghost Tab";
    case "RELEASED":
      return "Released from scheduler";
    default: {
      const unreachableEvent: never = event;
      return String(unreachableEvent);
    }
  }
}

function describeRuntimeState(state: string): string {
  switch (state) {
    case "LOADING":
      return "Loading target page";
    case "PERCEIVING":
      return "Collecting page perception";
    case "INFERRING":
      return "Planning next action";
    case "ACTING":
      return "Executing action";
    case "COMPLETE":
      return "Completed execution";
    case "FAILED":
      return "Execution failed";
    default:
      return `State ${state.toLowerCase()}`;
  }
}

function describeSchedulerEvent(event: string): string {
  switch (event) {
    case "STARTED":
      return "Scheduler started task";
    case "SUCCEEDED":
      return "Scheduler marked task complete";
    case "FAILED":
      return "Scheduler failed task";
    case "CRASH_DETECTED":
      return "Ghost Tab crash detected";
    case "RETRYING":
      return "Retrying on fresh Ghost Tab";
    case "RESOURCE_BUDGET_EXCEEDED":
      return "Resource budget exceeded";
    case "RESOURCE_BUDGET_KILLED":
      return "Task terminated by budget policy";
    default:
      return `Scheduler ${event.toLowerCase()}`;
  }
}

function describeSubtaskAction(payload: {
  currentSubtaskIndex: number;
  totalSubtasks: number;
  subtaskIntent: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
}): string {
  return `Subtask ${payload.currentSubtaskIndex + 1}/${payload.totalSubtasks}: ${payload.subtaskIntent} (${payload.status.toLowerCase()})`;
}

function isHttpUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
