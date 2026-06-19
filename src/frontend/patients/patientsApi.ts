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

export async function validateTaxCode(tax_code: string) {
  return invoke<boolean>("validate_tax_code", { request: { tax_code } });
}

export async function createPatient(actor_user_id: number, patient: PatientInput) {
  return invoke<Patient>("create_patient", { request: { actor_user_id, ...patient } });
}

export async function updatePatient(actor_user_id: number, patient_id: number, patient: PatientInput) {
  return invoke<Patient>("update_patient", { request: { actor_user_id, patient_id, ...patient } });
}

export async function deletePatient(actor_user_id: number, patient_id: number) {
  return invoke<Patient>("delete_patient", { request: { actor_user_id, patient_id } });
}

export async function openPatientRecord(actor_user_id: number, patient_id: number) {
  return invoke<Patient>("open_patient_record", { request: { actor_user_id, patient_id } });
}

export async function patientTimeline(actor_user_id: number, patient_id: number) {
  return invoke<PatientTimelineEvent[]>("patient_timeline", { request: { actor_user_id, patient_id } });
}
