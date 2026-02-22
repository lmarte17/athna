import type { GhostTabCdpClient } from "../cdp/client.js";
import { createGhostTabTaskErrorDetail } from "../task/state-machine.js";
import {
  assertValidGhostTabIpcMessage,
  createGhostTabIpcMessage,
  type GhostTabIpcRequestMessage,
  type GhostTabIpcRequestType,
  type GhostTabIpcResponseMessage,
  type GhostTabIpcTaskErrorMessage,
  type InjectJsIpcPayload,
  type InputEventIpcPayload
} from "./schema.js";

const UNKNOWN_TASK_ID = "unknown-task";
const UNKNOWN_CONTEXT_ID = "unknown-context";

export interface GhostTabIpcRouterOptions {
  cdpClient: GhostTabCdpClient;
  logger?: (line: string) => void;
}

export class GhostTabIpcRouter {
  private readonly logger: (line: string) => void;

  constructor(private readonly options: GhostTabIpcRouterOptions) {
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  async handleRawMessage(raw: unknown): Promise<GhostTabIpcResponseMessage> {
    try {
      const message = assertValidGhostTabIpcMessage(raw, "inbound");
      if (message.type === "TASK_RESULT" || message.type === "TASK_ERROR") {
        return this.buildTaskErrorResponse({
          taskId: message.taskId,
          contextId: message.contextId,
          operation: "UNKNOWN",
          error: new Error(`Expected request message but received response type ${message.type}.`)
        });
      }
      return this.handleMessage(message);
    } catch (error) {
      return this.buildTaskErrorResponse({
        taskId: extractOptionalString(raw, "taskId") ?? UNKNOWN_TASK_ID,
        contextId: extractOptionalString(raw, "contextId") ?? UNKNOWN_CONTEXT_ID,
        operation: "UNKNOWN",
        error
      });
    }
  }

  async handleMessage(request: GhostTabIpcRequestMessage): Promise<GhostTabIpcResponseMessage> {
    try {
      const data = await this.routeRequestByType(request);
      return createGhostTabIpcMessage({
        type: "TASK_RESULT",
        taskId: request.taskId,
        contextId: request.contextId,
        payload: {
          operation: request.type,
          data
        }
      });
    } catch (error) {
      return this.buildTaskErrorResponse({
        taskId: request.taskId,
        contextId: request.contextId,
        operation: request.type,
        error
      });
    }
  }

  private async routeRequestByType(request: GhostTabIpcRequestMessage): Promise<unknown> {
    switch (request.type) {
      case "NAVIGATE": {
        await this.options.cdpClient.navigate(request.payload.url, request.payload.timeoutMs);
        const currentUrl = await this.options.cdpClient.getCurrentUrl();
        return {
          currentUrl
        };
      }
      case "SCREENSHOT": {
        return this.options.cdpClient.captureScreenshot(request.payload);
      }
      case "AX_TREE": {
        return this.options.cdpClient.extractInteractiveElementIndex({
          includeBoundingBoxes: request.payload.includeBoundingBoxes,
          charBudget: request.payload.charBudget
        });
      }
      case "INJECT_JS": {
        return this.executeInjectJsRequest(request.payload);
      }
      case "INPUT_EVENT": {
        return this.executeInputEventRequest(request.payload);
      }
      default: {
        // Exhaustive check to guarantee routing by typed message kind.
        const unhandledType: never = request;
        throw new Error(`Unhandled IPC request type: ${String(unhandledType)}`);
      }
    }
  }

  private async executeInjectJsRequest(payload: InjectJsIpcPayload): Promise<unknown> {
    const execution = await this.options.cdpClient.executeAction({
      action: "EXTRACT",
      target: null,
      text: payload.expression
    });
    if (execution.status === "failed") {
      throw new Error(execution.message ?? "INJECT_JS action execution failed.");
    }
    return {
      status: execution.status,
      currentUrl: execution.currentUrl,
      extractedData: execution.extractedData,
      message: execution.message
    };
  }

  private async executeInputEventRequest(payload: InputEventIpcPayload): Promise<unknown> {
    const execution = await this.options.cdpClient.executeAction(payload);
    if (execution.status === "failed") {
      throw new Error(execution.message ?? `INPUT_EVENT action ${payload.action} failed.`);
    }
    return execution;
  }

  private buildTaskErrorResponse(input: {
    taskId: string;
    contextId: string;
    operation: GhostTabIpcRequestType | "UNKNOWN";
    error: unknown;
  }): GhostTabIpcTaskErrorMessage {
    this.logger(
      `[ipc-router] type=TASK_ERROR taskId=${input.taskId} contextId=${input.contextId} operation=${input.operation}`
    );
    return createGhostTabIpcMessage({
      type: "TASK_ERROR",
      taskId: input.taskId,
      contextId: input.contextId,
      payload: {
        operation: input.operation,
        error: createGhostTabTaskErrorDetail({
          error: input.error,
          retryable: input.operation !== "UNKNOWN"
        })
      }
    });
  }
}

export function createGhostTabIpcRouter(options: GhostTabIpcRouterOptions): GhostTabIpcRouter {
  return new GhostTabIpcRouter(options);
}

function extractOptionalString(raw: unknown, field: string): string | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = (raw as Record<string, unknown>)[field];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
