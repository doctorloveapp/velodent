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

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function searchPatients(query: string, limit = 10) {
  return invoke<Patient[]>("search_patients", { query, limit });
}

export async function ensureDevelopmentPatient() {
  return invoke<Patient>("ensure_development_patient");
}

