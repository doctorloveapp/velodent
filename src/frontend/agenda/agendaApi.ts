import { invoke } from "@tauri-apps/api/core";

export type AppointmentStatus = "booked" | "arrived" | "waiting" | "in_chair" | "completed" | "cancelled";

export interface ChairConfig {
  chair_count: number;
}

export interface Appointment {
  id: number;
  patient_id: number | null;
  patient_name: string | null;
  chair_number: number;
  title: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  color_tag: string | null;
  google_calendar_event_id: string | null;
  last_google_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarSyncStatus {
  configured: boolean;
  connected: boolean;
  queued_jobs: number;
  failed_jobs: number;
  last_sync_at: string | null;
}

export interface AppointmentInput {
  patient_id?: number;
  chair_number: number;
  title: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  color_tag?: string;
  notes?: string;
}

export interface GoogleAuthorizationUrl {
  authorization_url: string;
  redirect_uri: string;
  scopes: string[];
}

export async function getChairConfig(actor_user_id: number) {
  return invoke<ChairConfig>("get_chair_config", { request: { actor_user_id } });
}

export async function listAppointments(actor_user_id: number, starts_from: string, starts_to: string) {
  return invoke<Appointment[]>("list_appointments", { request: { actor_user_id, starts_from, starts_to } });
}

export async function createAppointment(actor_user_id: number, input: AppointmentInput) {
  return invoke<Appointment>("create_appointment", { request: { actor_user_id, ...input } });
}

export async function moveAppointment(
  actor_user_id: number,
  appointment_id: number,
  chair_number: number,
  starts_at: string,
  ends_at: string
) {
  return invoke<Appointment>("move_appointment", {
    request: { actor_user_id, appointment_id, chair_number, starts_at, ends_at }
  });
}

export async function updateAppointmentStatus(actor_user_id: number, appointment_id: number, status: AppointmentStatus) {
  return invoke<Appointment>("update_appointment_status", { request: { actor_user_id, appointment_id, status } });
}

export async function googleCalendarSyncStatus(actor_user_id: number) {
  return invoke<GoogleCalendarSyncStatus>("google_calendar_sync_status", { request: { actor_user_id } });
}

export async function googleCalendarAuthorizationUrl(actor_user_id: number, state = "velodent-local") {
  return invoke<GoogleAuthorizationUrl>("google_calendar_authorization_url", { request: { actor_user_id, state } });
}

export async function processGoogleCalendarSync(actor_user_id: number, limit = 10) {
  return invoke<{ processed: number; failed: number }>("process_google_calendar_sync", { request: { actor_user_id, limit } });
}
