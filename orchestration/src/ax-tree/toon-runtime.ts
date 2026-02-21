import path from "node:path";
import { pathToFileURL } from "node:url";

import type { NormalizedAXNode } from "../cdp/client.js";
import { readBooleanEnv } from "../config/runtime.js";

export type ToonEncodedAXTreeNode = [
  string,
  string,
  string | null,
  ...(string | number[])[]
];

export type ToonEncodedAXTree = [string, ...ToonEncodedAXTreeNode[]];

interface ToonEncoderModule {
  encodeNormalizedAxTreeToon(nodes: NormalizedAXNode[]): ToonEncodedAXTree;
}

export interface ToonEncodingResult {
  payload: NormalizedAXNode[] | ToonEncodedAXTree;
  usedToonEncoding: boolean;
  encodedCharCount: number;
}

let toonEncoderModulePromise: Promise<ToonEncoderModule> | null = null;

function resolveToonEncoderModule(loadedModule: unknown): ToonEncoderModule {
  const namespace =
    loadedModule &&
    typeof loadedModule === "object" &&
    "default" in loadedModule &&
    loadedModule.default
      ? (loadedModule as { default: unknown }).default
      : loadedModule;

  if (!namespace || typeof namespace !== "object") {
    throw new Error("Unable to resolve toon encoder module.");
  }

  const candidate = namespace as Partial<ToonEncoderModule>;
  if (typeof candidate.encodeNormalizedAxTreeToon !== "function") {
    throw new Error("Toon encoder module is missing encodeNormalizedAxTreeToon.");
  }

  return candidate as ToonEncoderModule;
}

async function loadToonEncoderModule(): Promise<ToonEncoderModule> {
  if (!toonEncoderModulePromise) {
    const modulePath = path.resolve(__dirname, "..", "..", "src", "ax-tree", "toon-encoder.js");
    toonEncoderModulePromise = import(pathToFileURL(modulePath).href).then((loadedModule) =>
      resolveToonEncoderModule(loadedModule)
    );
  }

  return toonEncoderModulePromise;
}

export function isToonEncodingEnabled(): boolean {
  return readBooleanEnv("USE_TOON_ENCODING", true);
}

export async function encodeNormalizedAXTreeForNavigator(
  nodes: NormalizedAXNode[]
): Promise<ToonEncodingResult> {
  if (!isToonEncodingEnabled()) {
    const rawCharCount = JSON.stringify(nodes).length;
    return {
      payload: nodes,
      usedToonEncoding: false,
      encodedCharCount: rawCharCount
    };
  }

  const toonEncoderModule = await loadToonEncoderModule();
  const encodedPayload = toonEncoderModule.encodeNormalizedAxTreeToon(nodes);
  const encodedCharCount = JSON.stringify(encodedPayload).length;

  return {
    payload: encodedPayload,
    usedToonEncoding: true,
    encodedCharCount
  };
}
