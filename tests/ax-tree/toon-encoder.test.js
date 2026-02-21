"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { encodeNormalizedAxTreeToon } = require("../../orchestration/src/ax-tree/toon-encoder.js");

const INPUT_PATH = path.resolve(
  __dirname,
  "../../docs/artifacts/phase1/phase1-1.4/wikipedia-normalized-ax-tree.json"
);
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../../docs/artifacts/phase1/phase1-1.4/wikipedia-toon-encoded-ax-tree.json"
);

function clip(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function run() {
  const normalizedNodes = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
  const encodedOutput = encodeNormalizedAxTreeToon(normalizedNodes);

  if (!Array.isArray(encodedOutput) || encodedOutput.length === 0) {
    throw new Error("Encoded output is empty or invalid.");
  }

  const originalJson = JSON.stringify(normalizedNodes);
  const encodedJson = JSON.stringify(encodedOutput);
  const originalChars = originalJson.length;
  const encodedChars = encodedJson.length;
  const charDelta = originalChars - encodedChars;
  const reductionPct = originalChars === 0 ? 0 : (charDelta / originalChars) * 100;

  console.log("AX Toon Encoding Validation");
  console.log(`Input: ${INPUT_PATH}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Node count: ${normalizedNodes.length}`);
  console.log(`Original chars: ${originalChars}`);
  console.log(`Encoded chars: ${encodedChars}`);
  console.log(`Delta: ${charDelta} (${reductionPct.toFixed(2)}%)`);
  console.log("");
  console.log(`Legend: ${encodedOutput[0]}`);
  console.log("");
  console.log("Sample (original | encoded):");

  const sampleCount = Math.min(5, normalizedNodes.length);
  for (let i = 0; i < sampleCount; i += 1) {
    const originalRow = clip(JSON.stringify(normalizedNodes[i]), 160).padEnd(165, " ");
    const encodedRow = clip(JSON.stringify(encodedOutput[i + 1]), 160);
    console.log(`${String(i).padStart(2, "0")} ${originalRow} | ${encodedRow}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(encodedOutput, null, 2));
  console.log("");
  console.log(`Saved encoded artifact: ${OUTPUT_PATH}`);
}

run();
