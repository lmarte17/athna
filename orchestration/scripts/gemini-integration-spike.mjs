import {
  GoogleGenAI,
  createPartFromBase64,
  createPartFromText,
  createUserContent
} from "@google/genai";

const DEFAULT_FLASH_MODEL = "gemini-2.5-flash";
const API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
const PROJECT_ID = process.env.PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
const REGION = process.env.REGION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
const FORCE_VERTEX =
  process.env.GEMINI_USE_VERTEX === "true" || process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? DEFAULT_FLASH_MODEL;
const VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? DEFAULT_FLASH_MODEL;

// Tiny valid PNG payload used for multimodal round-trip verification.
const TINY_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const TINY_IMAGE_MIME = "image/png";

function parseStructuredJson(rawText, contextLabel) {
  if (!rawText) {
    throw new Error(`${contextLabel}: empty model response`);
  }

  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenceMatch) {
      throw new Error(`${contextLabel}: response was not valid JSON`);
    }
    return JSON.parse(fenceMatch[1]);
  }
}

async function generateJson(ai, params, contextLabel) {
  const response = await ai.models.generateContent(params);
  const parsed = parseStructuredJson(response.text, contextLabel);
  return { parsed, rawText: response.text ?? "" };
}

function normalizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    return {
      message,
      details: JSON.parse(message)
    };
  } catch {
    return { message };
  }
}

async function runSpike(ai, authMode) {
  const textPrompt = [
    "You are a JSON-only API.",
    "Return ONLY a single JSON object with keys: channel, status, summary.",
    "Use channel='text', status='ok', and summary as a short sentence confirming the round-trip."
  ].join("\n");

  const textResult = await generateJson(
    ai,
    {
      model: TEXT_MODEL,
      contents: createUserContent(createPartFromText(textPrompt))
    },
    "text"
  );

  const visionPrompt = [
    "You are a JSON-only API.",
    "You are given a JPEG screenshot.",
    "Return ONLY a single JSON object with keys: channel, scene, ui_elements, confidence.",
    "Rules: channel='vision'; ui_elements must be an array of strings; confidence must be 0..1."
  ].join("\n");

  const visionInput = createUserContent([
    createPartFromText(visionPrompt),
    createPartFromBase64(TINY_IMAGE_BASE64, TINY_IMAGE_MIME)
  ]);

  const visionResult = await generateJson(
    ai,
    {
      model: VISION_MODEL,
      contents: visionInput
    },
    "vision"
  );

  const output = {
    ok: true,
    timestamp: new Date().toISOString(),
    authMode,
    models: {
      text: TEXT_MODEL,
      vision: VISION_MODEL
    },
    parsed: {
      text: textResult.parsed,
      vision: visionResult.parsed
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

function canUseVertex() {
  return Boolean(PROJECT_ID && REGION);
}

async function main() {
  const attemptErrors = [];

  const tryApiKeyFirst = API_KEY && !FORCE_VERTEX;
  if (tryApiKeyFirst) {
    try {
      const geminiClient = new GoogleGenAI({ apiKey: API_KEY });
      await runSpike(geminiClient, "gemini-api-key");
      return;
    } catch (error) {
      attemptErrors.push({ mode: "gemini-api-key", ...normalizeError(error) });
    }
  }

  if (canUseVertex()) {
    try {
      const vertexClient = new GoogleGenAI({
        vertexai: true,
        project: PROJECT_ID,
        location: REGION
      });
      await runSpike(vertexClient, "vertex-ai");
      return;
    } catch (error) {
      attemptErrors.push({ mode: "vertex-ai", ...normalizeError(error) });
    }
  }

  if (!tryApiKeyFirst && !canUseVertex()) {
    throw new Error(
      "No valid auth mode configured. Set GEMINI_API_KEY for Gemini API or PROJECT_ID/REGION with Vertex auth."
    );
  }

  throw new Error(JSON.stringify({ attempts: attemptErrors }));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: normalizeError(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
