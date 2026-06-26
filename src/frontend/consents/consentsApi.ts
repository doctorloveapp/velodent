import { invoke } from "@tauri-apps/api/core";
import { fromLanSessionToken, isLanSessionToken, lanFetch } from "@/frontend/mobile/lanBridgeApi";

export interface ConsentTemplate {
  id: number;
  template_key: string;
  title: string;
  body: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RenderedConsent {
  template: ConsentTemplate;
  rendered_body: string;
  required_checkbox_count: number;
}

export interface PatientConsent {
  id: number;
  patient_id: number;
  template_id: number | null;
  template_title: string;
  consent_type: string;
  file_asset_id: number | null;
  relative_path: string | null;
  signed_at: string | null;
  signed_by_user_id: number | null;
  signed_device_id: number | null;
  created_at: string;
  updated_at: string;
}

export async function listConsentTemplates(session_token: string) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<ConsentTemplate[]>("/api/consents/templates", fromLanSessionToken(session_token));
  }
  return invoke<ConsentTemplate[]>("list_consent_templates", { request: { session_token } });
}

export async function updateConsentTemplate(request: {
  session_token: string;
  template_id: number;
  title: string;
  body: string;
  active: boolean;
}) {
  return invoke<ConsentTemplate>("update_consent_template", { request });
}

export async function renderConsentTemplate(session_token: string, patient_id: number, template_id: number) {
  if (isLanSessionToken(session_token)) {
    const params = new URLSearchParams({ patient_id: String(patient_id), template_id: String(template_id) });
    return lanFetch<RenderedConsent>(`/api/consents/render?${params.toString()}`, fromLanSessionToken(session_token));
  }
  return invoke<RenderedConsent>("render_consent_template", {
    request: { session_token, patient_id, template_id }
  });
}

export async function signPatientConsent(
  session_token: string,
  input: {
    patient_id: number;
    template_id: number;
    checkbox_confirmations: boolean[];
    signature_data_url: string;
  }
) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<PatientConsent>("/api/consents/sign", fromLanSessionToken(session_token), {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  }
  return invoke<PatientConsent>("sign_patient_consent", {
    request: { session_token, ...input }
  });
}

export async function listPatientConsents(session_token: string, patient_id: number) {
  if (isLanSessionToken(session_token)) {
    const params = new URLSearchParams({ patient_id: String(patient_id) });
    return lanFetch<PatientConsent[]>(`/api/consents/patient?${params.toString()}`, fromLanSessionToken(session_token));
  }
  return invoke<PatientConsent[]>("list_patient_consents", { request: { session_token, patient_id } });
}
