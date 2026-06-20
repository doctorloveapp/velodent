import type { User } from "@/frontend/settings/settingsApi";

const LAN_TOKEN_STORAGE_KEY = "velodent:lan-device-token";
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

export async function lanFetch<T>(path: string, sessionOrDeviceToken: string, init?: RequestInit): Promise<T> {
  const deviceToken = fromLanSessionToken(sessionOrDeviceToken);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${deviceToken}`);
  const response = await fetch(`${lanBridgeBaseUrl()}${path}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(`LAN request failed: ${String(response.status)}`);
  }
  return (await response.json()) as T;
}
