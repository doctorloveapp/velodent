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

export interface PairingCodeInfo {
  code: string;
  expires_at_epoch_ms: number;
  public_url: string | null;
  server_port: number;
  tunnel_error: string | null;
}

export interface GoogleAuthorizationUrl {
  authorization_url: string;
  redirect_uri: string;
  scopes: string[];
}

export interface ClinicalService {
  id: number;
  code: string;
  name: string;
  category: string | null;
  base_price_cents: number;
  sort_order: number;
  active: boolean;
}

export interface GoogleCalendarAccount {
  id: number;
  email: string | null;
  calendar_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LicenseStatus {
  hardware_id: string;
  activated: boolean;
  email: string | null;
  activated_at: string | null;
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

export async function licenseStatus() {
  return invoke<LicenseStatus>("license_status");
}

export async function activateLicense(activation_key: string) {
  return invoke<LicenseStatus>("activate_license", { request: { activation_key } });
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

export async function googleLoginAuthorizationUrl(state = "velodent-login") {
  return invoke<GoogleAuthorizationUrl>("google_login_authorization_url", { request: { state } });
}

export async function exchangeGoogleLoginCode(code: string) {
  return toSessionUser(await invoke<AuthSession>("exchange_google_login_code", { request: { code } }));
}

export async function startGoogleLogin(state = "velodent-login") {
  return toSessionUser(await invoke<AuthSession>("start_google_login", { request: { state } }));
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

export async function getPairingCode(session_token: string) {
  return invoke<PairingCodeInfo>("get_pairing_code", { request: { session_token } });
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

export async function pickStudioLogoPath(session_token: string) {
  return invoke<string | null>("pick_studio_logo_path", { request: { session_token } });
}

export async function listClinicalServices(session_token: string) {
  return invoke<ClinicalService[]>("list_clinical_services", { request: { session_token } });
}

export async function listClinicalServicesCatalog(session_token: string) {
  return invoke<ClinicalService[]>("list_clinical_services_catalog", { request: { session_token } });
}

export async function updateClinicalServicePrice(request: {
  session_token: string;
  service_id: number;
  base_price_cents: number;
}) {
  return invoke<ClinicalService>("update_clinical_service_price", { request });
}

export async function upsertClinicalService(request: {
  session_token: string;
  service_id?: number;
  code: string;
  name: string;
  category?: string;
  base_price_cents: number;
  sort_order: number;
  active: boolean;
}) {
  return invoke<ClinicalService>("upsert_clinical_service", { request });
}

export async function reorderClinicalService(request: {
  session_token: string;
  service_id: number;
  target_service_id: number;
}) {
  return invoke<ClinicalService[]>("reorder_clinical_service", { request });
}

export async function listGoogleCalendarAccounts(session_token: string) {
  return invoke<GoogleCalendarAccount[]>("list_google_calendar_accounts", { request: { session_token } });
}

export async function startGoogleCalendarAccountLink(session_token: string) {
  return invoke<GoogleCalendarAccount>("start_google_calendar_account_link", {
    request: { session_token, state: "velodent-calendar" }
  });
}

function toSessionUser(session: AuthSession): User {
  return {
    ...session.user,
    session_token: session.session_token
  };
}
