"use strict";

// Codec is intentionally derived from roles/states observed in:
// docs/artifacts/phase1/phase1-1.4/wikipedia-normalized-ax-tree.json
const ROLE_CODE_LOOKUP = Object.freeze({
  button: "btn",
  link: "lnk",
  checkbox: "chk",
  searchbox: "inp"
});

const STATE_CODE_LOOKUP = Object.freeze({
  focusable: "f",
  focused: "F",
  settable: "s",
  "checked:true": "c1",
  "editable:plaintext": "ept",
  "keyshortcuts:Ctrl+Alt+F": "ks1"
});

const URL_STATE_PREFIX = "url:";
const URL_STATE_CODE = "u";

const TOON_LEGEND =
  "roles: btn=button, lnk=link, chk=checkbox, inp=searchbox; " +
  "states: f=focusable, F=focused, s=settable, c1=checked:true, " +
  "ept=editable:plaintext, ks1=keyshortcuts:Ctrl+Alt+F, u:<url>=url:<url>; " +
  "bbox: [x,y,w,h] rounded to nearest 5px";

function roundToNearestFive(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.round(value / 5) * 5;
}

function encodeBoundingBox(boundingBox) {
  if (!boundingBox || typeof boundingBox !== "object") {
    return null;
  }

  return [
    roundToNearestFive(boundingBox.x),
    roundToNearestFive(boundingBox.y),
    roundToNearestFive(boundingBox.width),
    roundToNearestFive(boundingBox.height)
  ];
}

function encodeRole(role) {
  if (typeof role !== "string" || role.length === 0) {
    return role;
  }

  return ROLE_CODE_LOOKUP[role] ?? role;
}

function encodeState(state) {
  if (typeof state !== "string" || state.length === 0) {
    return "";
  }

  if (Object.prototype.hasOwnProperty.call(STATE_CODE_LOOKUP, state)) {
    return STATE_CODE_LOOKUP[state];
  }

  if (state.startsWith(URL_STATE_PREFIX)) {
    return `${URL_STATE_CODE}:${state.slice(URL_STATE_PREFIX.length)}`;
  }

  return state;
}

function encodeStates(states) {
  if (!Array.isArray(states) || states.length === 0) {
    return "";
  }

  const encodedStates = states
    .map((state) => encodeState(state))
    .filter((state) => typeof state === "string" && state.length > 0);

  if (encodedStates.length === 0) {
    return "";
  }

  return encodedStates.join("|");
}

function hasValue(value) {
  return typeof value === "string" && value.length > 0;
}

function encodeNode(node) {
  if (!node || typeof node !== "object") {
    throw new Error("encodeNode expected a normalized AX node object.");
  }

  const encodedNode = [String(node.nodeId), encodeRole(node.role), node.name];

  if (hasValue(node.value)) {
    encodedNode.push(node.value);
  }

  const encodedStateString = encodeStates(node.states);
  if (encodedStateString.length > 0) {
    encodedNode.push(encodedStateString);
  }

  const encodedBoundingBox = encodeBoundingBox(node.boundingBox);
  if (encodedBoundingBox) {
    encodedNode.push(encodedBoundingBox);
  }

  return encodedNode;
}

function encodeNormalizedAxTreeToon(normalizedAxTreeNodes) {
  if (!Array.isArray(normalizedAxTreeNodes)) {
    throw new Error("encodeNormalizedAxTreeToon expected an array of normalized AX nodes.");
  }

  const encodedNodes = normalizedAxTreeNodes.map((node) => encodeNode(node));
  return [TOON_LEGEND, ...encodedNodes];
}

module.exports = {
  TOON_LEGEND,
  ROLE_CODE_LOOKUP,
  STATE_CODE_LOOKUP,
  encodeNormalizedAxTreeToon
};
