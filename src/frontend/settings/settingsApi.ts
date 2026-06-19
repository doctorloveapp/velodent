import { invoke } from "@tauri-apps/api/core";

export type Role = "admin" | "odontoiatra" | "aso";

export interface User {
  id: number;
  username: string;
  google_email: string | null;
  role: Role;
  active: boolean;
  session_token?: string;
}

interface BackendUser {
  id: number;
  username: string;
  google_email: string | null;
  role: Role;
  active: boolean;
}

interface AuthSession {
  user: BackendUser;
  session_token: string;
}

export interface BootstrapStatus {
  needs_first_admin: boolean;
}

export interface AuthorizedGoogleAccount {
  id: number;
  email: string;
  role: Role;
  active: boolean;
}

export interface AuthorizedDevice {
  id: number;
  user_id: number | null;
  label: string;
  allowed_lan_cidr: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

export interface StudioSettings {
  clinic_name: string | null;
  logo_relative_path: string | null;
  chair_count: number;
  data_directory: string | null;
  holiday_periods_json: string;
}

export interface DeviceAuthorization {
  device: AuthorizedDevice;
  token_once: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function bootstrapStatus() {
  return invoke<BootstrapStatus>("bootstrap_status");
}

export async function createFirstAdmin(request: {
  username: string;
  password: string;
  google_email?: string;
}) {
  return toSessionUser(await invoke<AuthSession>("create_first_admin", { request }));
}

export async function login(request: { username: string; password: string }) {
  return toSessionUser(await invoke<AuthSession>("login", { request }));
}

export async function listUsers(session_token: string) {
  return invoke<BackendUser[]>("list_users", { request: { session_token } });
}

export async function createUser(request: {
  session_token: string;
  username: string;
  password?: string;
  google_email?: string;
  role: Role;
}) {
  return invoke<BackendUser>("create_user", { request });
}

export async function listAuthorizedGoogleAccounts(session_token: string) {
  return invoke<AuthorizedGoogleAccount[]>("list_authorized_google_accounts", { request: { session_token } });
}

export async function addAuthorizedGoogleAccount(request: {
  session_token: string;
  email: string;
  role: Role;
}) {
  return invoke<AuthorizedGoogleAccount>("add_authorized_google_account", { request });
}

export async function listDevices(session_token: string) {
  return invoke<AuthorizedDevice[]>("list_devices", { request: { session_token } });
}

export async function authorizeDevice(request: {
  session_token: string;
  user_id?: number;
  label: string;
  allowed_lan_cidr?: string;
  expires_at?: string;
}) {
  return invoke<DeviceAuthorization>("authorize_device", { request });
}

export async function revokeDevice(request: { session_token: string; device_id: number }) {
  return invoke<AuthorizedDevice>("revoke_device", { request });
}

export async function getStudioSettings(session_token: string) {
  return invoke<StudioSettings>("get_studio_settings", { request: { session_token } });
}

export async function updateStudioSettings(request: {
  session_token: string;
  clinic_name?: string;
  logo_relative_path?: string;
  chair_count: number;
  data_directory?: string;
  holiday_periods_json: string;
}) {
  return invoke<StudioSettings>("update_studio_settings", { request });
}

function toSessionUser(session: AuthSession): User {
  return {
    ...session.user,
    session_token: session.session_token
  };
}
