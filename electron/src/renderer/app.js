"use strict";
const RUNNING_TASK_STATUSES = new Set(["QUEUED", "RUNNING"]);
const COMPLETED_TASK_STATUSES = new Set([
    "SUCCEEDED",
    "FAILED",
    "CANCELLED"
]);
const MAX_VISIBLE_TASKS = 24;
const bridge = window.workspaceBridge;
if (!bridge) {
    throw new Error("workspaceBridge API unavailable.");
}
const tabStripElement = getElement("tab-strip");
const ghostStripElement = getElement("ghost-strip");
const newTabButtonElement = getElement("new-tab-button");
const startPageElement = getElement("start-page");
const dispatchSurfaceElement = getElement("dispatch-surface");
const topCommandFormElement = getElement("top-command-form");
const topCommandInputElement = getElement("top-command-input");
const topModeSelectElement = getElement("top-mode-select");
const startCommandFormElement = getElement("start-command-form");
const startCommandInputElement = getElement("start-command-input");
const startModeSelectElement = getElement("start-mode-select");
const statusSidebarElement = getElement("status-sidebar");
const statusSidebarToggleElement = getElement("sidebar-toggle");
const statusSidebarContextElement = getElement("sidebar-context-label");
const statusFeedElement = getElement("status-feed");
let currentState = null;
let draftCommand = "";
let selectedMode = "AUTO";
let commandSubmissionInFlight = false;
let transientErrorMessage = null;
let activeContextId = null;
let selectedTaskId = null;
let sidebarCollapsed = false;
let elapsedTickerHandle = null;
initializeUi().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dispatchSurfaceElement.classList.remove("hidden");
    dispatchSurfaceElement.innerHTML = `<div class="dispatch-card">Initialization failed: ${escapeHtml(message)}</div>`;
});
async function initializeUi() {
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
        const ghostTabs = getGhostTabsForContext(currentState.ghostTabs, activeContextId);
        renderStatusFeed(activeContextId, tasks, ghostTabs);
    }, 1000);
    const initialState = await bridge.getState();
    applyState(initialState);
    focusCommandInput("START_PAGE");
}
function wireCommandInput(inputElement) {
    inputElement.addEventListener("input", () => {
        draftCommand = inputElement.value;
        syncCommandInputs();
    });
}
function wireModeSelect(selectElement) {
    selectElement.addEventListener("change", () => {
        selectedMode = normalizeMode(selectElement.value);
        syncModeSelects();
    });
}
function wireCommandSubmit(formElement, source) {
    formElement.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitCommand(source);
    });
}
async function submitCommand(source) {
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
    }
    catch (error) {
        renderTransientError(error);
    }
    finally {
        commandSubmissionInFlight = false;
    }
}
function applyState(state) {
    currentState = state;
    const nextContextId = resolveActiveContextId(state);
    const contextTasks = getTasksForContext(state.tasks, nextContextId);
    const contextGhostTabs = getGhostTabsForContext(state.ghostTabs, nextContextId);
    synchronizeTaskSelection(state, nextContextId, contextTasks, contextGhostTabs);
    renderTabStrip(state.tabs, state.activeTabId, state.tasks);
    renderGhostStrip(state, nextContextId, contextGhostTabs);
    renderSidebarState();
    renderStatusFeed(nextContextId, contextTasks, contextGhostTabs);
    startPageElement.classList.toggle("hidden", !state.isStartPageActive);
    renderDispatchSurface();
}
function renderTabStrip(tabs, activeTabId, tasks) {
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
function renderGhostStrip(state, contextId, contextGhostTabs) {
    ghostStripElement.replaceChildren();
    if (!contextId) {
        ghostStripElement.appendChild(createGhostPlaceholder("Open a page tab to create and view Ghost tabs for that context."));
        return;
    }
    if (contextGhostTabs.length === 0) {
        ghostStripElement.appendChild(createGhostPlaceholder("No Ghost tabs yet for this context."));
        return;
    }
    const visibleGhostTabs = contextGhostTabs.slice(0, MAX_VISIBLE_TASKS);
    for (const [index, ghostTab] of visibleGhostTabs.entries()) {
        const tab = document.createElement("div");
        tab.role = "button";
        tab.tabIndex = 0;
        const isGhostSurfaceActive = state.activeGhostTabId === ghostTab.ghostTabId && state.activeSurface === "GHOST";
        const isSelected = state.activeGhostTabId === ghostTab.ghostTabId;
        tab.className = `ghost-tab ${ghostTab.status.toLowerCase()}${isSelected ? " active" : ""}${isGhostSurfaceActive ? " live" : ""}`;
        tab.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                tab.click();
            }
        });
        tab.addEventListener("click", () => {
            selectedTaskId = ghostTab.taskId;
            void bridge.switchGhostTab(ghostTab.ghostTabId).then(applyState).catch(renderTransientError);
        });
        const left = document.createElement("span");
        left.className = "ghost-tab-title";
        left.textContent = `Ghost ${index + 1} ${ghostTab.intent}`;
        tab.appendChild(left);
        const right = document.createElement("span");
        right.className = "ghost-tab-meta";
        right.textContent = ghostTab.progressLabel ?? ghostTab.currentState ?? ghostTab.status;
        tab.appendChild(right);
        if (ghostTab.canCancel) {
            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.className = "ghost-tab-action cancel";
            cancelButton.textContent = "x";
            cancelButton.setAttribute("aria-label", `Cancel ${ghostTab.intent} task`);
            cancelButton.addEventListener("click", (event) => {
                event.stopPropagation();
                void bridge.cancelTask(ghostTab.taskId).catch(renderTransientError);
            });
            tab.appendChild(cancelButton);
        }
        if (ghostTab.canDismiss) {
            const dismissButton = document.createElement("button");
            dismissButton.type = "button";
            dismissButton.className = "ghost-tab-action dismiss";
            dismissButton.textContent = "-";
            dismissButton.setAttribute("aria-label", `Dismiss completed ${ghostTab.intent} tab`);
            dismissButton.addEventListener("click", (event) => {
                event.stopPropagation();
                void bridge.dismissGhostTab(ghostTab.ghostTabId).then(applyState).catch(renderTransientError);
            });
            tab.appendChild(dismissButton);
        }
        ghostStripElement.appendChild(tab);
    }
}
function renderDispatchSurface(dispatchOverride) {
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
    const modeDescriptor = dispatch.modeOverride === null
        ? "Auto mode"
        : `Override: ${dispatch.modeOverride.toLowerCase()}`;
    const confidencePct = Math.round(dispatch.classification.confidence * 100);
    const classificationDescriptor = `${dispatch.classification.intent} via ${dispatch.classification.source === "MODE_OVERRIDE" ? "mode override" : "auto rules"} (${confidencePct}%)`;
    const targetDescriptor = dispatch.classification.intent === "NAVIGATE" && dispatch.normalizedUrl
        ? `Navigating to ${dispatch.normalizedUrl}`
        : `Dispatched ${dispatch.classification.intent.toLowerCase()} in ${dispatch.workspaceContextId} via ${dispatch.executionPlan.route}`;
    const taskDescriptor = dispatch.taskId ? ` task=${dispatch.taskId}` : "";
    dispatchSurfaceElement.innerHTML = `<div class="dispatch-card">${escapeHtml(`${targetDescriptor}${taskDescriptor} (${modeDescriptor}; ${classificationDescriptor})`)}</div>`;
}
function renderSidebarState() {
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
function renderStatusFeed(contextId, contextTasks, contextGhostTabs) {
    statusFeedElement.replaceChildren();
    if (!contextId) {
        statusFeedElement.appendChild(createStatusPlaceholder("Run a command from a page context to start context-scoped Ghost tasks."));
        return;
    }
    if (contextTasks.length === 0) {
        statusFeedElement.appendChild(createStatusPlaceholder("No active or completed Ghost tasks in this context yet."));
        return;
    }
    const ghostTabByTaskId = new Map(contextGhostTabs.map((ghostTab) => [ghostTab.taskId, ghostTab]));
    const visibleTasks = contextTasks.slice(0, MAX_VISIBLE_TASKS);
    for (const task of visibleTasks) {
        const item = document.createElement("div");
        item.role = "button";
        item.tabIndex = 0;
        item.className = `status-item${task.taskId === selectedTaskId ? " active" : ""}`;
        item.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                item.click();
            }
        });
        item.addEventListener("click", () => {
            selectedTaskId = task.taskId;
            const ghostTab = ghostTabByTaskId.get(task.taskId) ?? null;
            if (ghostTab) {
                void bridge.switchGhostTab(ghostTab.ghostTabId).then(applyState).catch(renderTransientError);
                return;
            }
            renderStatusFeed(contextId, contextTasks, contextGhostTabs);
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
            cancelBtn.addEventListener("click", (event) => {
                event.stopPropagation();
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
function createGhostPlaceholder(message) {
    const placeholder = document.createElement("div");
    placeholder.className = "ghost-placeholder";
    placeholder.textContent = message;
    return placeholder;
}
function createStatusPlaceholder(message) {
    const placeholder = document.createElement("div");
    placeholder.className = "status-placeholder";
    placeholder.textContent = message;
    return placeholder;
}
function resolveActiveContextId(state) {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
    if (!activeTab || activeTab.kind !== "WEB") {
        return null;
    }
    return activeTab.id;
}
function synchronizeTaskSelection(state, nextContextId, contextTasks, contextGhostTabs) {
    const contextChanged = nextContextId !== activeContextId;
    activeContextId = nextContextId;
    const selectedGhostTaskId = state.activeGhostTabId !== null
        ? contextGhostTabs.find((ghostTab) => ghostTab.ghostTabId === state.activeGhostTabId)?.taskId ?? null
        : null;
    if (selectedGhostTaskId) {
        selectedTaskId = selectedGhostTaskId;
        return;
    }
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
function getTasksForContext(tasks, contextId) {
    if (!contextId) {
        return [];
    }
    return tasks.filter((task) => task.workspaceContextId === contextId);
}
function getGhostTabsForContext(ghostTabs, contextId) {
    if (!contextId) {
        return [];
    }
    return ghostTabs.filter((ghostTab) => ghostTab.workspaceContextId === contextId);
}
function buildContextTaskStats(tasks) {
    const stats = new Map();
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
function formatTabBadgeText(stats) {
    if (stats.running > 0 && stats.completed > 0) {
        return `${stats.running}+${stats.completed}`;
    }
    if (stats.running > 0) {
        return `${stats.running}`;
    }
    return `C${stats.completed}`;
}
function deriveCurrentAction(task) {
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
function formatElapsed(task) {
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
function focusCommandInput(target) {
    if (target === "START_PAGE" && currentState?.isStartPageActive) {
        startCommandInputElement.focus();
        startCommandInputElement.select();
        return;
    }
    topCommandInputElement.focus();
    topCommandInputElement.select();
}
function syncCommandInputs() {
    if (topCommandInputElement.value !== draftCommand) {
        topCommandInputElement.value = draftCommand;
    }
    if (startCommandInputElement.value !== draftCommand) {
        startCommandInputElement.value = draftCommand;
    }
}
function syncModeSelects() {
    const serialized = selectedMode;
    if (topModeSelectElement.value !== serialized) {
        topModeSelectElement.value = serialized;
    }
    if (startModeSelectElement.value !== serialized) {
        startModeSelectElement.value = serialized;
    }
}
function normalizeMode(rawMode) {
    const candidate = rawMode.trim().toUpperCase();
    if (candidate === "BROWSE" || candidate === "DO" || candidate === "MAKE" || candidate === "RESEARCH") {
        return candidate;
    }
    return "AUTO";
}
function renderTransientError(error) {
    transientErrorMessage = error instanceof Error ? error.message : String(error);
    renderDispatchSurface();
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element #${id}`);
    }
    return element;
}
window.addEventListener("beforeunload", () => {
    if (elapsedTickerHandle !== null) {
        window.clearInterval(elapsedTickerHandle);
        elapsedTickerHandle = null;
    }
});
