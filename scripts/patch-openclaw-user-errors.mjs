#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_LIMIT_OR_UNAVAILABLE_TEXT =
  "⚠️ Model limit reached or unavailable right now. Please try again later, or use /new to start a fresh session.";

const TARGET_FILE = path.join("src", "auto-reply", "reply", "agent-runner-execution.ts");

const ORIGINAL_SIGNATURE = "function buildExternalRunFailureText(message: string): string {";
const PATCHED_SIGNATURE = "function buildExternalRunFailureText(message: string, err?: unknown): string {";

const HELPER = `function isModelLimitOrUnavailableSummary(err: unknown): boolean {
  if (!isFallbackSummaryError(err) || err.attempts.length === 0) {
    return false;
  }
  return err.attempts.some((attempt) => {
    const reason = attempt.reason;
    return (
      reason === "billing" ||
      reason === "rate_limit" ||
      reason === "overloaded" ||
      reason === "timeout" ||
      reason === "auth" ||
      reason === "auth_permanent"
    );
  });
}

`;

const ORIGINAL_GENERIC_RETURN =
  '  return "⚠️ Something went wrong while processing your request. Please try again, or use /new to start a fresh session.";';
const PATCHED_GENERIC_RETURN = `  if (isModelLimitOrUnavailableSummary(err)) {
    return "${MODEL_LIMIT_OR_UNAVAILABLE_TEXT}";
  }
${ORIGINAL_GENERIC_RETURN}`;

const ORIGINAL_CALL = ": buildExternalRunFailureText(message);";
const PATCHED_CALL = ": buildExternalRunFailureText(message, err);";

function replaceOnce(content, from, to, label) {
  if (content.includes(to)) {
    return { content, changed: false };
  }
  if (!content.includes(from)) {
    throw new Error(`Could not find ${label} patch anchor`);
  }
  return { content: content.replace(from, to), changed: true };
}

// OpenClaw >= 2026.5.x replaced buildExternalRunFailureText with native
// model-exhaustion surfacing (buildRateLimitCooldownMessage: billing, rate-limit
// cooldown, usage-limit messages) — the behavior this patch used to add.
const UPSTREAM_NATIVE_MARKER = "function buildRateLimitCooldownMessage(";

export function patchOpenClawUserErrors(rootDir) {
  const targetPath = path.join(rootDir, TARGET_FILE);
  let content = fs.readFileSync(targetPath, "utf8");
  let changed = false;

  if (!content.includes("buildExternalRunFailureText")) {
    if (content.includes(UPSTREAM_NATIVE_MARKER)) {
      return { changedFiles: 0, targetPath, skipped: "upstream-native" };
    }
    throw new Error(
      "buildExternalRunFailureText is gone but no native replacement found — inspect the new OpenClaw error-surfacing code before building",
    );
  }

  const signature = replaceOnce(
    content,
    ORIGINAL_SIGNATURE,
    HELPER + PATCHED_SIGNATURE,
    "buildExternalRunFailureText signature",
  );
  content = signature.content;
  changed = signature.changed || changed;

  const genericReturn = replaceOnce(
    content,
    ORIGINAL_GENERIC_RETURN,
    PATCHED_GENERIC_RETURN,
    "generic external run failure return",
  );
  content = genericReturn.content;
  changed = genericReturn.changed || changed;

  const call = replaceOnce(
    content,
    ORIGINAL_CALL,
    PATCHED_CALL,
    "external run failure call site",
  );
  content = call.content;
  changed = call.changed || changed;

  if (changed) {
    fs.writeFileSync(targetPath, content);
  }

  return { changedFiles: changed ? 1 : 0, targetPath };
}

function main() {
  const rootDir = process.argv[2] || process.cwd();
  const result = patchOpenClawUserErrors(rootDir);
  const state = result.skipped
    ? `skipped (${result.skipped})`
    : result.changedFiles
      ? "patched"
      : "already patched";
  console.log(`[patch-openclaw-user-errors] ${state} ${result.targetPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
