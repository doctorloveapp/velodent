import { invoke } from "@tauri-apps/api/core";

export interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  tax_code: string;
  date_of_birth: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  privacy_consent_signed: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientInput {
  first_name: string;
  last_name: string;
  tax_code: string;
  date_of_birth: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface PatientTimelineEvent {
  action: string;
  created_at: string;
}

export interface RxAsset {
  id: number;
  patient_id: number;
  file_asset_id: number;
  relative_path: string;
  mime_type: string | null;
  sha256_hex: string | null;
  size_bytes: number | null;
  rx_type: string;
  tooth_number: number | null;
  acquired_at: string;
  created_at: string;
}

export interface RxAssetDataUrl {
  file_asset_id: number;
  mime_type: string;
  data_url: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function searchPatients(session_token: string, query: string, limit = 10) {
  return invoke<Patient[]>("search_patients", { request: { session_token, query, limit } });
}

export async function ensureDevelopmentPatient(session_token: string) {
  return invoke<Patient>("ensure_development_patient", { request: { session_token } });
}

export async function validateTaxCode(tax_code: string) {
  return invoke<boolean>("validate_tax_code", { request: { tax_code } });
}

export async function createPatient(session_token: string, patient: PatientInput) {
  return invoke<Patient>("create_patient", { request: { session_token, ...patient } });
}

export async function updatePatient(session_token: string, patient_id: number, patient: PatientInput) {
  return invoke<Patient>("update_patient", { request: { session_token, patient_id, ...patient } });
}

export async function deletePatient(session_token: string, patient_id: number) {
  return invoke<Patient>("delete_patient", { request: { session_token, patient_id } });
}

export async function openPatientRecord(session_token: string, patient_id: number) {
  return invoke<Patient>("open_patient_record", { request: { session_token, patient_id } });
}

export async function patientTimeline(session_token: string, patient_id: number) {
  return invoke<PatientTimelineEvent[]>("patient_timeline", { request: { session_token, patient_id } });
}

export async function importRxFile(request: {
  session_token: string;
  patient_id: number;
  source_path: string;
  rx_type?: string;
  tooth_number?: number;
}) {
  return invoke<RxAsset>("import_rx_file", { request });
}

export async function listRxAssets(session_token: string, patient_id: number) {
  return invoke<RxAsset[]>("list_rx_assets", { request: { session_token, patient_id } });
}

export async function rxAssetDataUrl(session_token: string, file_asset_id: number) {
  return invoke<RxAssetDataUrl>("rx_asset_data_url", { request: { session_token, file_asset_id } });
}
