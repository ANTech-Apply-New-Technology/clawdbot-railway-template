import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MODEL_LIMIT_OR_UNAVAILABLE_TEXT,
  patchOpenClawUserErrors,
} from "../scripts/patch-openclaw-user-errors.mjs";

const SOURCE_SNIPPET = `
function buildExternalRunFailureText(message: string): string {
  const normalizedMessage = collapseRepeatedFailureDetail(message);
  if (isToolResultTurnMismatchError(normalizedMessage)) {
    return "⚠️ Session history got out of sync. Please try again, or use /new to start a fresh session.";
  }
  const missingApiKeyFailure = buildMissingApiKeyFailureText(normalizedMessage);
  if (missingApiKeyFailure) {
    return missingApiKeyFailure;
  }
  const oauthRefreshFailure = classifyOAuthRefreshFailure(normalizedMessage);
  if (oauthRefreshFailure) {
    const loginCommand = buildOAuthRefreshFailureLoginCommand(oauthRefreshFailure.provider);
    if (oauthRefreshFailure.reason) {
      return \`⚠️ Model login expired on the gateway\${oauthRefreshFailure.provider ? \` for \${oauthRefreshFailure.provider}\` : ""}. Re-auth with \\\`\${loginCommand}\\\`, then try again.\`;
    }
    return \`⚠️ Model login failed on the gateway\${oauthRefreshFailure.provider ? \` for \${oauthRefreshFailure.provider}\` : ""}. Please try again. If this keeps happening, re-auth with \\\`\${loginCommand}\\\`.\`;
  }
  return "⚠️ Something went wrong while processing your request. Please try again, or use /new to start a fresh session.";
}

const fallbackText = isBilling
  ? BILLING_ERROR_USER_MESSAGE
  : isRateLimit
    ? buildRateLimitCooldownMessage(err)
    : isContextOverflow
      ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model."
      : isRoleOrderingError
        ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
        : shouldSurfaceToControlUi
          ? \`⚠️ Agent failed before reply: \${trimmedMessage}.\\nLogs: openclaw logs --follow\`
          : buildExternalRunFailureText(message);
`;

function writeFixture(root) {
  const targetDir = path.join(root, "src", "auto-reply", "reply");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "agent-runner-execution.ts"), SOURCE_SNIPPET);
}

test("patchOpenClawUserErrors adds model-limit wording for external fallback failures", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-error-patch-"));
  writeFixture(root);

  const result = patchOpenClawUserErrors(root);
  const patched = fs.readFileSync(
    path.join(root, "src", "auto-reply", "reply", "agent-runner-execution.ts"),
    "utf8",
  );

  assert.equal(result.changedFiles, 1);
  assert.match(patched, /function buildExternalRunFailureText\(message: string, err\?: unknown\): string/);
  assert.match(patched, /isFallbackSummaryError\(err\)/);
  assert.match(patched, /isModelLimitOrUnavailableSummary\(err\)/);
  assert.match(patched, /buildExternalRunFailureText\(message, err\)/);
  assert.match(patched, new RegExp(MODEL_LIMIT_OR_UNAVAILABLE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Dockerfile applies the OpenClaw user-error patch during build", () => {
  const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(dockerfile, /COPY scripts\/patch-openclaw-user-errors\.mjs/);
  assert.match(dockerfile, /node \/tmp\/patch-openclaw-user-errors\.mjs \/openclaw/);
});
