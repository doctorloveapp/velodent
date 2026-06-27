import type { User } from "@/frontend/settings/settingsApi";

const LAN_TOKEN_STORAGE_KEY = "velodent:lan-device-token";
const LAN_DEVICE_UID_STORAGE_KEY = "velodent:lan-device-uid";
const LAN_SESSION_PREFIX = "lan:";

interface PairResponse {
  device: {
    id: number;
    user_id: number | null;
    label: string;
    allowed_lan_cidr: string | null;
    revoked_at: string | null;
    expires_at: string | null;
  };
  token_once: string;
}

interface LanUser {
  id: number;
  username: string;
  google_email: string | null;
  role: User["role"];
  active: boolean;
}

export class LanRequestError extends Error {
  readonly detail: string;
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail ? `LAN request failed: ${String(status)} ${detail}` : `LAN request failed: ${String(status)}`);
    this.detail = detail;
    this.status = status;
  }
}

export function lanBridgeBaseUrl() {
  const host = window.location.hostname || "127.0.0.1";
  return `http://${host}:1422`;
}

export function isLanSessionToken(sessionToken: string) {
  return sessionToken.startsWith(LAN_SESSION_PREFIX);
}

export function toLanSessionToken(deviceToken: string) {
  return `${LAN_SESSION_PREFIX}${deviceToken}`;
}

export function fromLanSessionToken(sessionToken: string) {
  return isLanSessionToken(sessionToken) ? sessionToken.slice(LAN_SESSION_PREFIX.length) : sessionToken;
}

export function storedLanDeviceToken() {
  return window.localStorage.getItem(LAN_TOKEN_STORAGE_KEY);
}

export function clearStoredLanDeviceToken() {
  window.localStorage.removeItem(LAN_TOKEN_STORAGE_KEY);
}

export function isLanTokenRejected(error: unknown) {
  if (!(error instanceof LanRequestError)) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return error.status === 401 || (
    error.status === 403
    && !detail.includes("lan only")
    && !detail.includes("outside authorized lan")
  );
}

export function storedLanDeviceUid() {
  const existing = window.localStorage.getItem(LAN_DEVICE_UID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `vd-${String(Date.now())}-${Math.random().toString(36).slice(2, 12)}`;
  window.localStorage.setItem(LAN_DEVICE_UID_STORAGE_KEY, generated);
  return generated;
}

export async function lanHealth() {
  const response = await fetch(`${lanBridgeBaseUrl()}/health`);
  if (!response.ok) {
    throw new Error("LAN bridge unavailable");
  }
}

export async function pairLanDevice(pin: string) {
  const response = await fetch(`${lanBridgeBaseUrl()}/pair`, {
    body: JSON.stringify({
      pin,
      device_uid: storedLanDeviceUid(),
      label: navigator.userAgent.slice(0, 80)
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  if (!response.ok) {
    throw new Error("LAN pairing failed");
  }
  const paired = (await response.json()) as PairResponse;
  window.localStorage.setItem(LAN_TOKEN_STORAGE_KEY, paired.token_once);
  return paired.token_once;
}

export async function lanCurrentUser(deviceToken: string): Promise<User> {
  const user = await lanFetch<LanUser>("/api/me", deviceToken);
  return {
    ...user,
    session_token: toLanSessionToken(deviceToken)
  };
}

export async function restoreLanCurrentUser(deviceToken: string, attempts = 4): Promise<User> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await lanHealth();
      return await lanCurrentUser(deviceToken);
    } catch (error) {
      lastError = error;
      if (isLanTokenRejected(error) || attempt === attempts - 1) {
        break;
      }
      await delay(300 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LAN bridge unavailable");
}

export async function lanFetch<T>(path: string, sessionOrDeviceToken: string, init?: RequestInit): Promise<T> {
  const deviceToken = fromLanSessionToken(sessionOrDeviceToken);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${deviceToken}`);
  const response = await fetch(`${lanBridgeBaseUrl()}${path}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new LanRequestError(response.status, await responseErrorDetail(response));
  }
  return (await response.json()) as T;
}

async function responseErrorDetail(response: Response) {
  try {
    const payload = (await response.clone().json()) as { error?: string };
    return payload.error ?? "";
  } catch {
    return response.statusText;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
