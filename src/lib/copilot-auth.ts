/**
 * GitHub Copilot device OAuth — mirrors VS Code Copilot Chat / OpenCode.
 *
 * Source of truth: anomalyco/opencode-copilot-auth (GitHubCopilotChat/0.35.0)
 * Client ID Iv1.b507a08c87ecfe98 is the public VS Code Copilot GitHub App.
 */
import { COPILOT_OAUTH } from "./config";

export type CopilotDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Pre-filled device page (VS Code shows code + URL; we also deep-link). */
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type CopilotDevicePollResult =
  | { status: "pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | { status: "complete"; githubToken: string }
  | { status: "denied"; error: string }
  | { status: "expired"; error: string }
  | { status: "failed"; error: string };

const DEVICE_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": COPILOT_OAUTH.headers["User-Agent"],
} as const;

function verificationUriComplete(verificationUri: string, userCode: string) {
  try {
    const url = new URL(verificationUri);
    if (!url.searchParams.has("user_code")) {
      url.searchParams.set("user_code", userCode);
    }
    return url.toString();
  } catch {
    const base = verificationUri.replace(/\?.*$/, "");
    return `${base}?user_code=${encodeURIComponent(userCode)}`;
  }
}

/** Step 1 — same request shape as VS Code Copilot Chat. */
export async function requestCopilotDeviceCode(): Promise<CopilotDeviceAuthorization> {
  const res = await fetch(COPILOT_OAUTH.deviceCodeUrl, {
    method: "POST",
    headers: DEVICE_HEADERS,
    body: JSON.stringify({
      client_id: COPILOT_OAUTH.clientId,
      scope: COPILOT_OAUTH.scope,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Copilot device code failed: ${res.status} ${text.slice(0, 240)}`);
  }
  let data: {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`Copilot device code returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (data.error || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(
      data.error_description ||
        data.error ||
        "GitHub device code response missing codes",
    );
  }
  const interval = Math.max(5, data.interval || 5);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: verificationUriComplete(
      data.verification_uri,
      data.user_code,
    ),
    expiresIn: data.expires_in || 900,
    interval,
  };
}

/** Step 2 — poll until GitHub returns the OAuth access token (ghu_). */
export async function pollCopilotDeviceCode(
  deviceCode: string,
  fallbackInterval = 5,
): Promise<CopilotDevicePollResult> {
  const res = await fetch(COPILOT_OAUTH.accessTokenUrl, {
    method: "POST",
    headers: DEVICE_HEADERS,
    body: JSON.stringify({
      client_id: COPILOT_OAUTH.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const text = await res.text();
  let data: {
    access_token?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  } = {};
  try {
    data = text.trim() ? (JSON.parse(text) as typeof data) : {};
  } catch {
    // Rare form-encoded fallback
    const params = new URLSearchParams(text);
    data = {
      access_token: params.get("access_token") || undefined,
      error: params.get("error") || undefined,
      error_description: params.get("error_description") || undefined,
      interval: params.get("interval")
        ? Number(params.get("interval"))
        : undefined,
    };
  }

  if (data.access_token) {
    return { status: "complete", githubToken: data.access_token };
  }

  const interval = Math.max(
    fallbackInterval,
    typeof data.interval === "number" && data.interval > 0
      ? data.interval
      : fallbackInterval,
  );

  if (data.error === "authorization_pending") {
    return { status: "pending", interval };
  }
  if (data.error === "slow_down") {
    return { status: "slow_down", interval: interval + 5 };
  }
  if (data.error === "access_denied") {
    return {
      status: "denied",
      error: data.error_description || "Authorization was denied on GitHub",
    };
  }
  if (data.error === "expired_token") {
    return {
      status: "expired",
      error: data.error_description || "Device code expired — start again",
    };
  }
  if (data.error === "incorrect_device_code") {
    return {
      status: "failed",
      error:
        data.error_description ||
        "Incorrect device code (start OAuth once and authorize that code only)",
    };
  }

  // OpenCode treats non-OK without a recognized body as failed.
  if (!res.ok && !data.error) {
    return {
      status: "failed",
      error: `Copilot poll failed (${res.status}): ${text.slice(0, 200)}`,
    };
  }

  if (data.error) {
    return {
      status: "failed",
      error: data.error_description || data.error,
    };
  }

  return { status: "pending", interval };
}
