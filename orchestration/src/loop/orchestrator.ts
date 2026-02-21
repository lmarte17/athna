import type {
  ActionExecutionResult,
  AgentActionInput,
  GhostTabCdpClient,
  InteractiveElementIndexResult
} from "../cdp/client.js";
import { encodeNormalizedAXTreeForNavigator } from "../ax-tree/toon-runtime.js";
import type { NavigatorActionDecision, NavigatorEngine } from "../navigator/engine.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_HISTORY_WINDOW = 5;

export type LoopState = "LOADING" | "PERCEIVING" | "INFERRING" | "ACTING" | "COMPLETE" | "FAILED";

export interface PerceptionActionTaskInput {
  intent: string;
  startUrl: string;
  maxSteps?: number;
}

export interface LoopStepRecord {
  step: number;
  state: LoopState;
  currentUrl: string;
  action: NavigatorActionDecision | null;
  execution: ActionExecutionResult | null;
  interactiveElementCount: number;
  normalizedNodeCount: number;
  normalizedCharCount: number;
  navigatorNormalizedTreeCharCount: number;
  navigatorObservationCharCount: number;
  usedToonEncoding: boolean;
  timestamp: string;
}

export interface PerceptionActionTaskResult {
  status: "DONE" | "FAILED" | "MAX_STEPS";
  intent: string;
  startUrl: string;
  finalUrl: string;
  stepsTaken: number;
  history: LoopStepRecord[];
  finalAction: NavigatorActionDecision | null;
  finalExecution: ActionExecutionResult | null;
}

export interface PerceptionActionLoopOptions {
  cdpClient: GhostTabCdpClient;
  navigatorEngine: NavigatorEngine;
  maxSteps?: number;
  logger?: (line: string) => void;
}

class PerceptionActionLoop {
  private readonly maxSteps: number;
  private readonly logger: (line: string) => void;

  constructor(private readonly options: PerceptionActionLoopOptions) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  async runTask(input: PerceptionActionTaskInput): Promise<PerceptionActionTaskResult> {
    if (!input.intent || !input.intent.trim()) {
      throw new Error("Task intent is required.");
    }

    if (!input.startUrl || !input.startUrl.trim()) {
      throw new Error("Task startUrl is required.");
    }

    const maxSteps = input.maxSteps ?? this.maxSteps;
    if (maxSteps <= 0) {
      throw new Error("maxSteps must be greater than zero.");
    }

    const history: LoopStepRecord[] = [];
    const previousActions: NavigatorActionDecision[] = [];
    const previousObservations: string[] = [];

    this.logger(`[loop] state=LOADING intent="${input.intent}" startUrl=${input.startUrl}`);
    await this.options.cdpClient.navigate(input.startUrl);

    let currentUrl = await this.options.cdpClient.getCurrentUrl();
    let finalAction: NavigatorActionDecision | null = null;
    let finalExecution: ActionExecutionResult | null = null;

    for (let step = 1; step <= maxSteps; step += 1) {
      this.logger(`[loop][step ${step}] state=PERCEIVING url=${currentUrl}`);
      const indexResult = await this.options.cdpClient.extractInteractiveElementIndex({
        includeBoundingBoxes: true,
        charBudget: 8_000
      });
      const treeEncoding = await encodeNormalizedAXTreeForNavigator(indexResult.normalizedAXTree.nodes);
      const observation = {
        currentUrl,
        interactiveElementIndex: indexResult.elements,
        normalizedAXTree: treeEncoding.payload,
        previousActions: previousActions.slice(-DEFAULT_HISTORY_WINDOW),
        previousObservations: previousObservations.slice(-DEFAULT_HISTORY_WINDOW)
      };
      const observationCharCount = JSON.stringify(observation).length;

      this.logger(
        `[loop][step ${step}] state=INFERRING url=${currentUrl} elements=${indexResult.elementCount} normalizedChars=${indexResult.normalizedCharCount} navigatorTreeChars=${treeEncoding.encodedCharCount} observationChars=${observationCharCount} toon=${treeEncoding.usedToonEncoding}`
      );
      const action = await this.options.navigatorEngine.decideNextAction({
        intent: input.intent,
        observation
      });
      finalAction = action;

      this.logger(
        `[loop][step ${step}] state=ACTING action=${action.action} confidence=${action.confidence.toFixed(2)} url=${currentUrl}`
      );
      const execution = await this.options.cdpClient.executeAction(this.toAgentAction(action));
      finalExecution = execution;
      currentUrl = execution.currentUrl;

      history.push(
        createStepRecord({
          step,
          state: execution.status === "failed" ? "FAILED" : "ACTING",
          currentUrl,
          action,
          execution,
          indexResult,
          navigatorNormalizedTreeCharCount: treeEncoding.encodedCharCount,
          navigatorObservationCharCount: observationCharCount,
          usedToonEncoding: treeEncoding.usedToonEncoding
        })
      );

      previousActions.push(action);
      previousObservations.push(
        `step=${step} action=${action.action} nav=${execution.navigationObserved} dom=${execution.domMutationObserved} url=${currentUrl}`
      );

      if (action.action === "DONE" || execution.status === "done") {
        this.logger(`[loop] state=COMPLETE status=DONE steps=${step} finalUrl=${currentUrl}`);
        return {
          status: "DONE",
          intent: input.intent,
          startUrl: input.startUrl,
          finalUrl: currentUrl,
          stepsTaken: step,
          history,
          finalAction: action,
          finalExecution: execution
        };
      }

      if (action.action === "FAILED" || execution.status === "failed") {
        this.logger(`[loop] state=FAILED status=FAILED steps=${step} finalUrl=${currentUrl}`);
        return {
          status: "FAILED",
          intent: input.intent,
          startUrl: input.startUrl,
          finalUrl: currentUrl,
          stepsTaken: step,
          history,
          finalAction: action,
          finalExecution: execution
        };
      }
    }

    this.logger(`[loop] state=FAILED status=MAX_STEPS steps=${maxSteps} finalUrl=${currentUrl}`);
    return {
      status: "MAX_STEPS",
      intent: input.intent,
      startUrl: input.startUrl,
      finalUrl: currentUrl,
      stepsTaken: maxSteps,
      history,
      finalAction,
      finalExecution
    };
  }

  private toAgentAction(action: NavigatorActionDecision): AgentActionInput {
    return {
      action: action.action,
      target: action.target,
      text: action.text,
      confidence: action.confidence,
      reasoning: action.reasoning
    };
  }
}

function createStepRecord(input: {
  step: number;
  state: LoopState;
  currentUrl: string;
  action: NavigatorActionDecision | null;
  execution: ActionExecutionResult | null;
  indexResult: InteractiveElementIndexResult;
  navigatorNormalizedTreeCharCount: number;
  navigatorObservationCharCount: number;
  usedToonEncoding: boolean;
}): LoopStepRecord {
  return {
    step: input.step,
    state: input.state,
    currentUrl: input.currentUrl,
    action: input.action,
    execution: input.execution,
    interactiveElementCount: input.indexResult.elementCount,
    normalizedNodeCount: input.indexResult.normalizedNodeCount,
    normalizedCharCount: input.indexResult.normalizedCharCount,
    navigatorNormalizedTreeCharCount: input.navigatorNormalizedTreeCharCount,
    navigatorObservationCharCount: input.navigatorObservationCharCount,
    usedToonEncoding: input.usedToonEncoding,
    timestamp: new Date().toISOString()
  };
}

export function createPerceptionActionLoop(options: PerceptionActionLoopOptions): PerceptionActionLoop {
  return new PerceptionActionLoop(options);
}
