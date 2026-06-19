import { invoke } from "@tauri-apps/api/core";

export type ToothState = "healthy" | "pathology" | "in_progress" | "performed" | "missing";
export type ClinicalRecordStatus = "diagnosed" | "in_quote" | "performed";

export interface ClinicalService {
  id: number;
  code: string;
  name: string;
  category: string | null;
  base_price_cents: number;
  active: boolean;
}

export interface ToothStatus {
  patient_id: number;
  tooth_number: number;
  state: ToothState;
  updated_by_user_id: number | null;
  updated_at: string;
}

export interface ClinicalRecord {
  id: number;
  patient_id: number;
  service_id: number | null;
  service_code: string | null;
  service_name: string | null;
  tooth_number: number | null;
  tooth_surface: string | null;
  pathology_description: string | null;
  status: ClinicalRecordStatus;
  ready_for_quote: boolean;
  notes: string | null;
  operator_user_id: number | null;
  operator_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClinicalRecordInput {
  patient_id: number;
  service_id?: number;
  tooth_number?: number;
  tooth_surface?: string;
  pathology_description?: string;
  status: ClinicalRecordStatus;
  ready_for_quote: boolean;
  notes?: string;
}

export async function listClinicalServices(actor_user_id: number) {
  return invoke<ClinicalService[]>("list_clinical_services", { request: { actor_user_id } });
}

export async function openClinicalView(actor_user_id: number, patient_id: number) {
  return invoke("open_clinical_view", { request: { actor_user_id, patient_id } });
}

export async function getToothStatuses(actor_user_id: number, patient_id: number) {
  return invoke<ToothStatus[]>("get_tooth_statuses", { request: { actor_user_id, patient_id } });
}

export async function setToothStatus(
  actor_user_id: number,
  patient_id: number,
  tooth_number: number,
  state: ToothState
) {
  return invoke<ToothStatus>("set_tooth_status", {
    request: { actor_user_id, patient_id, tooth_number, state }
  });
}

export async function createClinicalRecord(actor_user_id: number, input: ClinicalRecordInput) {
  return invoke<ClinicalRecord>("create_clinical_record", { request: { actor_user_id, ...input } });
}

export async function listClinicalRecords(
  actor_user_id: number,
  patient_id: number,
  filters: {
    date_from?: string;
    date_to?: string;
    tooth_number?: number;
    operator_user_id?: number;
  }
) {
  return invoke<ClinicalRecord[]>("list_clinical_records", {
    request: { actor_user_id, patient_id, ...filters }
  });
}

export async function markClinicalRecordReadyForQuote(
  actor_user_id: number,
  record_id: number,
  ready_for_quote: boolean
) {
  return invoke<ClinicalRecord>("mark_clinical_record_ready_for_quote", {
    request: { actor_user_id, record_id, ready_for_quote }
  });
}
