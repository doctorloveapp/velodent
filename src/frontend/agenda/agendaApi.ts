import { invoke } from "@tauri-apps/api/core";
import { fromLanSessionToken, isLanSessionToken, lanFetch } from "@/frontend/mobile/lanBridgeApi";

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

export interface AgendaBlock {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  google_calendar_event_id: string | null;
  last_google_sync_at: string | null;
  created_by_user_id: number | null;
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

export async function getChairConfig(session_token: string) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<ChairConfig>("/api/agenda/chairs", fromLanSessionToken(session_token));
  }
  return invoke<ChairConfig>("get_chair_config", { request: { session_token } });
}

export async function listAppointments(session_token: string, starts_from: string, starts_to: string) {
  if (isLanSessionToken(session_token)) {
    const params = new URLSearchParams({ from: starts_from, to: starts_to, sync: "1" });
    return lanFetch<Appointment[]>(`/api/agenda/appointments?${params.toString()}`, fromLanSessionToken(session_token));
  }
  return invoke<Appointment[]>("list_appointments", { request: { session_token, starts_from, starts_to } });
}

export async function listAgendaBlocks(session_token: string, starts_from: string, starts_to: string) {
  return invoke<AgendaBlock[]>("list_agenda_blocks", { request: { session_token, starts_from, starts_to } });
}

export async function createAgendaBlock(
  session_token: string,
  input: { title: string; starts_at: string; ends_at: string; all_day: boolean }
) {
  return invoke<AgendaBlock>("create_agenda_block", { request: { session_token, ...input } });
}

export async function deleteAgendaBlock(session_token: string, block_id: number) {
  return invoke<AgendaBlock>("delete_agenda_block", { request: { session_token, block_id } });
}

export async function createAppointment(session_token: string, input: AppointmentInput) {
  if (isLanSessionToken(session_token)) {
    return lanFetch<Appointment>("/api/agenda/appointments", fromLanSessionToken(session_token), {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  }
  return invoke<Appointment>("create_appointment", { request: { session_token, ...input } });
}

export async function moveAppointment(
  session_token: string,
  appointment_id: number,
  chair_number: number,
  starts_at: string,
  ends_at: string
) {
  return invoke<Appointment>("move_appointment", {
    request: { session_token, appointment_id, chair_number, starts_at, ends_at }
  });
}

export async function updateAppointmentStatus(session_token: string, appointment_id: number, status: AppointmentStatus) {
  return invoke<Appointment>("update_appointment_status", { request: { session_token, appointment_id, status } });
}

export async function deleteAppointment(session_token: string, appointment_id: number) {
  return invoke<Appointment>("delete_appointment", { request: { session_token, appointment_id } });
}

export async function googleCalendarSyncStatus(session_token: string) {
  return invoke<GoogleCalendarSyncStatus>("google_calendar_sync_status", { request: { session_token } });
}

export async function processGoogleCalendarSync(session_token: string) {
  return invoke<{ processed: number; failed: number }>("process_google_calendar_sync", {
    request: { session_token }
  });
}
