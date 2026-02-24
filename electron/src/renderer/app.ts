import type {
  CommandFocusTarget,
  CommandMode,
  CommandDispatchRecord,
  WorkspaceCommandSubmission,
  WorkspaceCommandSubmissionResult,
  WorkspaceState,
  WorkspaceTabState,
  WorkspaceTaskSummary
} from "../workspace-types.js";

interface WorkspaceBridgeApi {
  getState: () => Promise<WorkspaceState>;
  createTab: () => Promise<WorkspaceState>;
  switchTab: (tabId: string) => Promise<WorkspaceState>;
  closeTab: (tabId: string) => Promise<WorkspaceState>;
  submitCommand: (submission: WorkspaceCommandSubmission) => Promise<WorkspaceCommandSubmissionResult>;
  onState: (listener: (state: WorkspaceState) => void) => () => void;
  onCommandFocus: (listener: (target: CommandFocusTarget) => void) => () => void;
  getTaskScreenshot: (taskId: string) => Promise<string | null>;
  cancelTask: (taskId: string) => Promise<{ cancelled: boolean }>;
}

declare global {
  interface Window {
    workspaceBridge: WorkspaceBridgeApi;
  }
}

interface ContextTaskStats {
  running: number;
  completed: number;
}

const RUNNING_TASK_STATUSES = new Set<WorkspaceTaskSummary["status"]>(["QUEUED", "RUNNING"]);
const COMPLETED_TASK_STATUSES = new Set<WorkspaceTaskSummary["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const MAX_VISIBLE_TASKS = 16;

const bridge = window.workspaceBridge;
if (!bridge) {
  throw new Error("workspaceBridge API unavailable.");
}

const tabStripElement = getElement<HTMLDivElement>("tab-strip");
const ghostStripElement = getElement<HTMLDivElement>("ghost-strip");
const newTabButtonElement = getElement<HTMLButtonElement>("new-tab-button");
const startPageElement = getElement<HTMLElement>("start-page");
const dispatchSurfaceElement = getElement<HTMLDivElement>("dispatch-surface");
const topCommandFormElement = getElement<HTMLFormElement>("top-command-form");
const topCommandInputElement = getElement<HTMLInputElement>("top-command-input");
const topModeSelectElement = getElement<HTMLSelectElement>("top-mode-select");
const startCommandFormElement = getElement<HTMLFormElement>("start-command-form");
const startCommandInputElement = getElement<HTMLInputElement>("start-command-input");
const startModeSelectElement = getElement<HTMLSelectElement>("start-mode-select");
const statusSidebarElement = getElement<HTMLElement>("status-sidebar");
const statusSidebarToggleElement = getElement<HTMLButtonElement>("sidebar-toggle");
const statusSidebarContextElement = getElement<HTMLParagraphElement>("sidebar-context-label");
const statusFeedElement = getElement<HTMLDivElement>("status-feed");
const ghostViewerElement = getElement<HTMLDivElement>("ghost-viewer");
const ghostViewerLabelElement = getElement<HTMLSpanElement>("ghost-viewer-label");
const ghostViewerCloseElement = getElement<HTMLButtonElement>("ghost-viewer-close");
const ghostViewerImgElement = getElement<HTMLImageElement>("ghost-viewer-img");
const ghostViewerEmptyElement = getElement<HTMLParagraphElement>("ghost-viewer-empty");

let currentState: WorkspaceState | null = null;
let draftCommand = "";
let selectedMode: CommandMode = "AUTO";
let commandSubmissionInFlight = false;
let transientErrorMessage: string | null = null;
let activeContextId: string | null = null;
let selectedTaskId: string | null = null;
let sidebarCollapsed = false;
let elapsedTickerHandle: number | null = null;
let viewerTaskId: string | null = null;
let viewerPollHandle: number | null = null;

initializeUi().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dispatchSurfaceElement.classList.remove("hidden");
  dispatchSurfaceElement.innerHTML = `<div class="dispatch-card">Initialization failed: ${escapeHtml(message)}</div>`;
});

async function initializeUi(): Promise<void> {
  wireCommandInput(topCommandInputElement);
  wireCommandInput(startCommandInputElement);
  wireModeSelect(topModeSelectElement);
  wireModeSelect(startModeSelectElement);
  wireCommandSubmit(topCommandFormElement, "TOP_BAR");
  wireCommandSubmit(startCommandFormElement, "START_PAGE");

  statusSidebarToggleElement.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    renderSidebarState();
  });

  ghostViewerCloseElement.addEventListener("click", () => {
    closeGhostViewer();
  });

  newTabButtonElement.addEventListener("click", () => {
    void bridge.createTab().then(applyState).catch(renderTransientError);
  });

  bridge.onState((state) => {
    applyState(state);
  });

  bridge.onCommandFocus((target) => {
    focusCommandInput(target);
  });

  elapsedTickerHandle = window.setInterval(() => {
    if (!currentState) {
      return;
    }
    const tasks = getTasksForContext(currentState.tasks, activeContextId);
    renderStatusFeed(activeContextId, tasks);
  }, 1000);

  const initialState = await bridge.getState();
  applyState(initialState);
  focusCommandInput("START_PAGE");
}

function wireCommandInput(inputElement: HTMLInputElement): void {
  inputElement.addEventListener("input", () => {
    draftCommand = inputElement.value;
    syncCommandInputs();
  });
}

function wireModeSelect(selectElement: HTMLSelectElement): void {
  selectElement.addEventListener("change", () => {
    selectedMode = normalizeMode(selectElement.value);
    syncModeSelects();
  });
}

function wireCommandSubmit(
  formElement: HTMLFormElement,
  source: WorkspaceCommandSubmission["source"]
): void {
  formElement.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCommand(source);
  });
}

async function submitCommand(source: WorkspaceCommandSubmission["source"]): Promise<void> {
  if (commandSubmissionInFlight) {
    return;
  }

  const trimmed = draftCommand.trim();
  if (!trimmed) {
    return;
  }

  commandSubmissionInFlight = true;
  transientErrorMessage = null;

  try {
    const result = await bridge.submitCommand({
      text: trimmed,
      mode: selectedMode,
      source
    });

    if (!result.accepted) {
      transientErrorMessage = result.error ?? "Command was rejected.";
      renderDispatchSurface();
      return;
    }

    if (result.clearInput) {
      draftCommand = "";
      syncCommandInputs();
    }

    if (result.dispatch) {
      renderDispatchSurface(result.dispatch);
    }
  } catch (error) {
    renderTransientError(error);
  } finally {
    commandSubmissionInFlight = false;
  }
}

function applyState(state: WorkspaceState): void {
  currentState = state;

  const nextContextId = resolveActiveContextId(state);
  const contextTasks = getTasksForContext(state.tasks, nextContextId);
  synchronizeTaskSelection(nextContextId, contextTasks);

  renderTabStrip(state.tabs, state.activeTabId, state.tasks);
  renderGhostStrip(nextContextId, contextTasks);
  renderSidebarState();
  renderStatusFeed(nextContextId, contextTasks);

  startPageElement.classList.toggle("hidden", !state.isStartPageActive);
  renderDispatchSurface();

  // Close viewer if its task no longer belongs to the active context (context switch).
  if (viewerTaskId) {
    const viewerTask = state.tasks.find((t) => t.taskId === viewerTaskId);
    if (!viewerTask || viewerTask.workspaceContextId !== nextContextId) {
      closeGhostViewer();
    } else if (
      viewerPollHandle !== null &&
      (viewerTask.status === "SUCCEEDED" || viewerTask.status === "FAILED" || viewerTask.status === "CANCELLED")
    ) {
      // Task finished or was cancelled — stop polling and take one final screenshot.
      stopGhostViewerPolling();
      refreshGhostViewerScreenshot();
    }
  }
}

function renderTabStrip(
  tabs: WorkspaceTabState[],
  activeTabId: string,
  tasks: WorkspaceState["tasks"]
): void {
  tabStripElement.replaceChildren();
  const statsByContext = buildContextTaskStats(tasks);

  for (const tab of tabs) {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = `tab-button${tab.id === activeTabId ? " active" : ""}`;
    tabButton.title = tab.url;
    tabButton.addEventListener("click", () => {
      void bridge.switchTab(tab.id).then(applyState).catch(renderTransientError);
    });

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.loading ? `${tab.title} ...` : tab.title;
    tabButton.appendChild(title);

    if (tab.kind === "WEB" && tab.id !== activeTabId) {
      const contextStats = statsByContext.get(tab.id);
      if (contextStats && (contextStats.running > 0 || contextStats.completed > 0)) {
        const badge = document.createElement("span");
        badge.className = "tab-badge";
        badge.textContent = formatTabBadgeText(contextStats);
        badge.title = `Running: ${contextStats.running}, Completed: ${contextStats.completed}`;
        tabButton.appendChild(badge);
      }
    }

    if (tab.canClose) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "tab-close";
      closeButton.textContent = "x";
      closeButton.setAttribute("aria-label", `Close ${tab.title}`);
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void bridge.closeTab(tab.id).then(applyState).catch(renderTransientError);
      });
      tabButton.appendChild(closeButton);
    }

    tabStripElement.appendChild(tabButton);
  }
}

function renderGhostStrip(
  contextId: string | null,
  contextTasks: WorkspaceState["tasks"]
): void {
  ghostStripElement.replaceChildren();

  if (!contextId) {
    ghostStripElement.appendChild(
      createGhostPlaceholder("Open a page tab to create and view Ghost tasks for that context.")
    );
    return;
  }

  // CANCELLED tasks are removed from the Ghost Strip per spec; they remain in the Status Feed.
  const activeContextTasks = contextTasks.filter((t) => t.status !== "CANCELLED");

  if (activeContextTasks.length === 0) {
    ghostStripElement.appendChild(createGhostPlaceholder("No Ghost tasks yet for this context."));
    return;
  }

  const visibleTasks = activeContextTasks.slice(0, MAX_VISIBLE_TASKS);
  for (const [index, task] of visibleTasks.entries()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `ghost-chip ${task.status.toLowerCase()}${task.taskId === selectedTaskId ? " active" : ""}`;
    chip.addEventListener("click", () => {
      selectedTaskId = task.taskId;
      renderGhostStrip(contextId, contextTasks);
      renderStatusFeed(contextId, contextTasks);
      openGhostViewer(task);
    });

    const label = document.createElement("span");
    label.textContent = `Ghost ${index + 1} ${task.intent} ${shortTaskId(task.taskId)}`;
    chip.appendChild(label);

    const state = document.createElement("span");
    state.className = "ghost-state";
    state.textContent = task.progressLabel ?? task.status;
    chip.appendChild(state);

    if (task.status === "QUEUED" || task.status === "RUNNING") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "ghost-chip-cancel";
      cancelBtn.textContent = "×";
      cancelBtn.setAttribute("aria-label", `Cancel ${task.intent} task`);
      cancelBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void bridge.cancelTask(task.taskId).catch(renderTransientError);
      });
      chip.appendChild(cancelBtn);
    }

    ghostStripElement.appendChild(chip);
  }
}

function renderDispatchSurface(dispatchOverride?: CommandDispatchRecord): void {
  if (transientErrorMessage) {
    dispatchSurfaceElement.classList.remove("hidden");
    dispatchSurfaceElement.innerHTML = `<div class="dispatch-card">${escapeHtml(transientErrorMessage)}</div>`;
    return;
  }

  const dispatch = dispatchOverride ?? currentState?.lastDispatch ?? null;
  if (!dispatch) {
    dispatchSurfaceElement.classList.add("hidden");
    dispatchSurfaceElement.textContent = "";
    return;
  }
  dispatchSurfaceElement.classList.remove("hidden");

  const modeDescriptor =
    dispatch.modeOverride === null
      ? "Auto mode"
      : `Override: ${dispatch.modeOverride.toLowerCase()}`;
  const confidencePct = Math.round(dispatch.classification.confidence * 100);
  const classificationDescriptor = `${dispatch.classification.intent} via ${
    dispatch.classification.source === "MODE_OVERRIDE" ? "mode override" : "auto rules"
  } (${confidencePct}%)`;
  const targetDescriptor =
    dispatch.classification.intent === "NAVIGATE" && dispatch.normalizedUrl
      ? `Navigating to ${dispatch.normalizedUrl}`
      : `Dispatched ${dispatch.classification.intent.toLowerCase()} in ${dispatch.workspaceContextId} via ${dispatch.executionPlan.route}`;
  const taskDescriptor = dispatch.taskId ? ` task=${dispatch.taskId}` : "";

  dispatchSurfaceElement.innerHTML = `<div class="dispatch-card">${escapeHtml(
    `${targetDescriptor}${taskDescriptor} (${modeDescriptor}; ${classificationDescriptor})`
  )}</div>`;
}

function renderSidebarState(): void {
  statusSidebarElement.classList.toggle("collapsed", sidebarCollapsed);
  statusSidebarToggleElement.setAttribute("aria-expanded", String(!sidebarCollapsed));
  statusSidebarToggleElement.textContent = sidebarCollapsed ? "<<" : ">>";

  const state = currentState;
  if (!state) {
    statusSidebarContextElement.textContent = "No active context";
    return;
  }

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  if (!activeTab || activeTab.kind !== "WEB") {
    statusSidebarContextElement.textContent = "Start Page context";
    return;
  }

  statusSidebarContextElement.textContent = `${activeTab.title} (${activeTab.id})`;
}

function renderStatusFeed(
  contextId: string | null,
  contextTasks: WorkspaceState["tasks"]
): void {
  statusFeedElement.replaceChildren();

  if (!contextId) {
    statusFeedElement.appendChild(
      createStatusPlaceholder("Run a command from a page context to start context-scoped Ghost tasks.")
    );
    return;
  }

  if (contextTasks.length === 0) {
    statusFeedElement.appendChild(
      createStatusPlaceholder("No active or completed Ghost tasks in this context yet.")
    );
    return;
  }

  const visibleTasks = contextTasks.slice(0, MAX_VISIBLE_TASKS);
  for (const task of visibleTasks) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `status-item${task.taskId === selectedTaskId ? " active" : ""}`;
    item.addEventListener("click", () => {
      selectedTaskId = task.taskId;
      renderStatusFeed(contextId, contextTasks);
      renderGhostStrip(contextId, contextTasks);
    });

    const head = document.createElement("div");
    head.className = "status-item-head";

    const title = document.createElement("p");
    title.className = "status-item-title";
    title.textContent = `${task.intent} ${task.taskId}`;
    head.appendChild(title);

    const state = document.createElement("p");
    state.className = "status-item-state";
    state.textContent = `${task.status} / ${task.currentState ?? "UNKNOWN"}`;
    head.appendChild(state);

    if (task.status === "QUEUED" || task.status === "RUNNING") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "status-item-cancel";
      cancelBtn.textContent = "Cancel";
      cancelBtn.setAttribute("aria-label", `Cancel task ${task.taskId}`);
      cancelBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void bridge.cancelTask(task.taskId).catch(renderTransientError);
      });
      head.appendChild(cancelBtn);
    }

    const action = document.createElement("p");
    action.className = "status-item-meta";
    action.textContent = `Action: ${task.currentAction ?? deriveCurrentAction(task)}`;

    const url = document.createElement("p");
    url.className = "status-item-meta";
    url.textContent = `URL: ${task.currentUrl ?? task.startUrl}`;

    const elapsed = document.createElement("p");
    elapsed.className = "status-item-meta";
    elapsed.textContent = `Elapsed: ${formatElapsed(task)}`;

    const progress = document.createElement("p");
    progress.className = "status-item-meta";
    progress.textContent = `Progress: ${task.progressLabel ?? "n/a"}`;

    item.appendChild(head);
    item.appendChild(action);
    item.appendChild(url);
    item.appendChild(elapsed);
    item.appendChild(progress);

    if (task.errorMessage) {
      const error = document.createElement("p");
      error.className = "status-item-meta status-item-error";
      error.textContent = `Error: ${task.errorMessage}`;
      item.appendChild(error);
    }

    statusFeedElement.appendChild(item);
  }
}

function createGhostPlaceholder(message: string): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "ghost-placeholder";
  placeholder.textContent = message;
  return placeholder;
}

function createStatusPlaceholder(message: string): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "status-placeholder";
  placeholder.textContent = message;
  return placeholder;
}

function resolveActiveContextId(state: WorkspaceState): string | null {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  if (!activeTab || activeTab.kind !== "WEB") {
    return null;
  }
  return activeTab.id;
}

function synchronizeTaskSelection(
  nextContextId: string | null,
  contextTasks: WorkspaceState["tasks"]
): void {
  const contextChanged = nextContextId !== activeContextId;
  activeContextId = nextContextId;

  if (contextChanged) {
    selectedTaskId = contextTasks[0]?.taskId ?? null;
    return;
  }

  if (selectedTaskId && !contextTasks.some((task) => task.taskId === selectedTaskId)) {
    selectedTaskId = contextTasks[0]?.taskId ?? null;
  }

  if (!selectedTaskId && contextTasks.length > 0) {
    selectedTaskId = contextTasks[0].taskId;
  }
}

function getTasksForContext(
  tasks: WorkspaceState["tasks"],
  contextId: string | null
): WorkspaceState["tasks"] {
  if (!contextId) {
    return [];
  }
  return tasks.filter((task) => task.workspaceContextId === contextId);
}

function buildContextTaskStats(tasks: WorkspaceState["tasks"]): Map<string, ContextTaskStats> {
  const stats = new Map<string, ContextTaskStats>();
  for (const task of tasks) {
    const existing = stats.get(task.workspaceContextId) ?? {
      running: 0,
      completed: 0
    };
    if (RUNNING_TASK_STATUSES.has(task.status)) {
      existing.running += 1;
    }
    if (COMPLETED_TASK_STATUSES.has(task.status)) {
      existing.completed += 1;
    }
    stats.set(task.workspaceContextId, existing);
  }
  return stats;
}

function formatTabBadgeText(stats: ContextTaskStats): string {
  if (stats.running > 0 && stats.completed > 0) {
    return `${stats.running}+${stats.completed}`;
  }
  if (stats.running > 0) {
    return `${stats.running}`;
  }
  return `C${stats.completed}`;
}

function deriveCurrentAction(task: WorkspaceTaskSummary): string {
  const state = (task.currentState ?? "").toUpperCase();
  if (state.startsWith("QUEUE_")) {
    return "Waiting in scheduler queue";
  }
  if (state.startsWith("SCHEDULER_")) {
    return "Scheduler lifecycle update";
  }
  if (state === "SUBTASK") {
    return task.progressLabel ?? "Subtask update";
  }
  if (state === "LOADING") {
    return "Loading page";
  }
  if (state === "PERCEIVING") {
    return "Collecting perception";
  }
  if (state === "INFERRING") {
    return "Planning action";
  }
  if (state === "ACTING") {
    return "Executing browser action";
  }
  if (state === "DONE" || state === "COMPLETE") {
    return "Task complete";
  }
  if (state === "FAILED") {
    return "Task failed";
  }
  return task.status.toLowerCase();
}

function formatElapsed(task: WorkspaceTaskSummary): string {
  const startSource = task.startedAt ?? task.createdAt;
  const startAtMs = Date.parse(startSource);
  if (!Number.isFinite(startAtMs)) {
    return "n/a";
  }

  const endAtMs = task.finishedAt ? Date.parse(task.finishedAt) : Date.now();
  const deltaMs = Math.max(0, endAtMs - startAtMs);

  if (deltaMs < 1000) {
    return `${deltaMs}ms`;
  }

  const totalSeconds = Math.floor(deltaMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function shortTaskId(taskId: string): string {
  const dashIndex = taskId.lastIndexOf("-");
  if (dashIndex >= 0 && dashIndex + 1 < taskId.length) {
    return taskId.slice(dashIndex + 1, dashIndex + 9);
  }
  return taskId.slice(0, 8);
}

function focusCommandInput(target: CommandFocusTarget): void {
  if (target === "START_PAGE" && currentState?.isStartPageActive) {
    startCommandInputElement.focus();
    startCommandInputElement.select();
    return;
  }

  topCommandInputElement.focus();
  topCommandInputElement.select();
}

function syncCommandInputs(): void {
  if (topCommandInputElement.value !== draftCommand) {
    topCommandInputElement.value = draftCommand;
  }
  if (startCommandInputElement.value !== draftCommand) {
    startCommandInputElement.value = draftCommand;
  }
}

function syncModeSelects(): void {
  const serialized = selectedMode;
  if (topModeSelectElement.value !== serialized) {
    topModeSelectElement.value = serialized;
  }
  if (startModeSelectElement.value !== serialized) {
    startModeSelectElement.value = serialized;
  }
}

function normalizeMode(rawMode: string): CommandMode {
  const candidate = rawMode.trim().toUpperCase();
  if (candidate === "BROWSE" || candidate === "DO" || candidate === "MAKE" || candidate === "RESEARCH") {
    return candidate;
  }
  return "AUTO";
}

function renderTransientError(error: unknown): void {
  transientErrorMessage = error instanceof Error ? error.message : String(error);
  renderDispatchSurface();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as TElement;
}

function openGhostViewer(task: WorkspaceTaskSummary): void {
  viewerTaskId = task.taskId;
  ghostViewerLabelElement.textContent = `Ghost ${shortTaskId(task.taskId)} · ${task.intent}`;
  ghostViewerElement.classList.remove("hidden");
  refreshGhostViewerScreenshot();
  startGhostViewerPolling(task);
}

function closeGhostViewer(): void {
  stopGhostViewerPolling();
  viewerTaskId = null;
  ghostViewerElement.classList.add("hidden");
  ghostViewerImgElement.src = "";
  ghostViewerImgElement.classList.add("hidden");
  ghostViewerEmptyElement.classList.remove("hidden");
}

function startGhostViewerPolling(task: WorkspaceTaskSummary): void {
  stopGhostViewerPolling();
  if (task.status === "RUNNING" || task.status === "QUEUED") {
    viewerPollHandle = window.setInterval(() => {
      refreshGhostViewerScreenshot();
    }, 500);
  }
}

function stopGhostViewerPolling(): void {
  if (viewerPollHandle !== null) {
    clearInterval(viewerPollHandle);
    viewerPollHandle = null;
  }
}

function refreshGhostViewerScreenshot(): void {
  const taskId = viewerTaskId;
  if (!taskId) {
    return;
  }
  void bridge.getTaskScreenshot(taskId).then((base64) => {
    if (viewerTaskId !== taskId) {
      return; // viewer was closed or switched while request was in flight
    }
    if (base64) {
      ghostViewerImgElement.src = `data:image/png;base64,${base64}`;
      ghostViewerImgElement.classList.remove("hidden");
      ghostViewerEmptyElement.classList.add("hidden");
    } else {
      ghostViewerImgElement.classList.add("hidden");
      ghostViewerEmptyElement.classList.remove("hidden");
    }
  });
}

window.addEventListener("beforeunload", () => {
  if (elapsedTickerHandle !== null) {
    window.clearInterval(elapsedTickerHandle);
    elapsedTickerHandle = null;
  }
  stopGhostViewerPolling();
});
