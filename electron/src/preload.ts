import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  CommandFocusTarget,
  WorkspaceCommandSubmission,
  WorkspaceCommandSubmissionResult,
  WorkspaceState
} from "./workspace-types.js";

const WORKSPACE_CHANNELS = {
  getState: "workspace:get-state",
  createTab: "workspace:create-tab",
  switchTab: "workspace:switch-tab",
  closeTab: "workspace:close-tab",
  submitCommand: "workspace:submit-command",
  stateEvent: "workspace:state",
  focusEvent: "workspace:command-focus"
} as const;

export interface WorkspaceBridgeApi {
  getState: () => Promise<WorkspaceState>;
  createTab: () => Promise<WorkspaceState>;
  switchTab: (tabId: string) => Promise<WorkspaceState>;
  closeTab: (tabId: string) => Promise<WorkspaceState>;
  submitCommand: (submission: WorkspaceCommandSubmission) => Promise<WorkspaceCommandSubmissionResult>;
  onState: (listener: (state: WorkspaceState) => void) => () => void;
  onCommandFocus: (listener: (target: CommandFocusTarget) => void) => () => void;
}

const workspaceBridgeApi: WorkspaceBridgeApi = {
  getState: async () => ipcRenderer.invoke(WORKSPACE_CHANNELS.getState),
  createTab: async () => ipcRenderer.invoke(WORKSPACE_CHANNELS.createTab),
  switchTab: async (tabId: string) => ipcRenderer.invoke(WORKSPACE_CHANNELS.switchTab, tabId),
  closeTab: async (tabId: string) => ipcRenderer.invoke(WORKSPACE_CHANNELS.closeTab, tabId),
  submitCommand: async (submission: WorkspaceCommandSubmission) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.submitCommand, submission),
  onState: (listener: (state: WorkspaceState) => void) => {
    const wrapped = (_event: IpcRendererEvent, state: WorkspaceState): void => {
      listener(state);
    };
    ipcRenderer.on(WORKSPACE_CHANNELS.stateEvent, wrapped);
    return () => {
      ipcRenderer.removeListener(WORKSPACE_CHANNELS.stateEvent, wrapped);
    };
  },
  onCommandFocus: (listener: (target: CommandFocusTarget) => void) => {
    const wrapped = (
      _event: IpcRendererEvent,
      payload: {
        target: CommandFocusTarget;
      }
    ): void => {
      listener(payload.target);
    };
    ipcRenderer.on(WORKSPACE_CHANNELS.focusEvent, wrapped);
    return () => {
      ipcRenderer.removeListener(WORKSPACE_CHANNELS.focusEvent, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("workspaceBridge", workspaceBridgeApi);
