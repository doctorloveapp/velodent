import { invoke } from "@tauri-apps/api/core";
import { fromLanSessionToken, isLanSessionToken, lanFetch } from "@/frontend/mobile/lanBridgeApi";

export type ToothState =
  | "healthy"
  | "pathology"
  | "in_progress"
  | "performed"
  | "caries"
  | "endodontics_needed"
  | "crown_needed"
  | "extraction_needed"
  | "filling_done"
  | "root_canal_done"
  | "crown_done"
  | "implant_done"
  | "missing";
export type ClinicalRecordStatus = "diagnosed" | "in_quote" | "performed";

export interface ClinicalService {
  id: number;
  code: string;
  name: string;
  category: string | null;
  base_price_cents: number;
  sort_order: number;
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

export async function listClinicalServices(session_token: string) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<ClinicalService[]>("/api/clinical/services", fromLanSessionToken(session_token));
  }
  return invoke<ClinicalService[]>("list_clinical_services", { request: { session_token } });
}

export async function openClinicalView(session_token: string, patient_id: number) {
  return invoke("open_clinical_view", { request: { session_token, patient_id } });
}

export async function getToothStatuses(session_token: string, patient_id: number) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<ToothStatus[]>(
      `/api/clinical/tooth-statuses?patient_id=${encodeURIComponent(String(patient_id))}`,
      fromLanSessionToken(session_token)
    );
  }
  return invoke<ToothStatus[]>("get_tooth_statuses", { request: { session_token, patient_id } });
}

export async function setToothStatus(
  session_token: string,
  patient_id: number,
  tooth_number: number,
  state: ToothState
) {
  return invoke<ToothStatus>("set_tooth_status", {
    request: { session_token, patient_id, tooth_number, state }
  });
}

export async function createClinicalRecord(session_token: string, input: ClinicalRecordInput) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<ClinicalRecord>("/api/clinical/records", fromLanSessionToken(session_token), {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  }
  return invoke<ClinicalRecord>("create_clinical_record", { request: { session_token, ...input } });
}

export async function deleteClinicalRecord(session_token: string, record_id: number) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<{ deleted: boolean }>("/api/clinical/records", fromLanSessionToken(session_token), {
      body: JSON.stringify({ record_id }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE"
    });
  }
  return invoke("delete_clinical_record", { request: { session_token, record_id } });
}

export async function listClinicalRecords(
  session_token: string,
  patient_id: number,
  filters: {
    date_from?: string;
    date_to?: string;
    tooth_number?: number;
    operator_user_id?: number;
  }
) {
  if (isLanSessionToken(session_token)) {
    const params = new URLSearchParams({ patient_id: String(patient_id) });
    return lanFetch<ClinicalRecord[]>(`/api/clinical/records?${params.toString()}`, fromLanSessionToken(session_token));
  }
  return invoke<ClinicalRecord[]>("list_clinical_records", {
    request: { session_token, patient_id, ...filters }
  });
}

export async function markClinicalRecordReadyForQuote(
  session_token: string,
  record_id: number,
  ready_for_quote: boolean
) {
  return invoke<ClinicalRecord>("mark_clinical_record_ready_for_quote", {
    request: { session_token, record_id, ready_for_quote }
  });
}
