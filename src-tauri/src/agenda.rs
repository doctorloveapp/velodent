use crate::{
    db::{AgendaBlock, Appointment, GoogleCalendarTokenRecord},
    integrations::google,
    state::AppState,
};
use tauri::Manager;

const BACKGROUND_SYNC_LIMIT: i64 = 25;

pub fn trigger_google_calendar_sync(app: &tauri::AppHandle, actor_user_id: i64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = process_google_calendar_sync(&app, actor_user_id).await {
            eprintln!("VeloDent calendar background sync failed: {error}");
        }
    });
}

pub async fn process_google_calendar_sync(
    app: &tauri::AppHandle,
    actor_user_id: i64,
) -> Result<(i64, i64), String> {
    let state = app.state::<AppState>();
    let accounts = {
        let database = state.database()?;
        database
            .active_google_calendar_tokens(actor_user_id)
            .map_err(|error| error.to_string())?
    };
    if accounts.is_empty() {
        return Ok((0, 0));
    }

    let jobs = {
        let database = state.database()?;
        database
            .pending_google_calendar_sync_jobs(actor_user_id, BACKGROUND_SYNC_LIMIT)
            .map_err(|error| error.to_string())?
    };
    let block_jobs = {
        let database = state.database()?;
        database
            .pending_google_calendar_block_sync_jobs(actor_user_id, BACKGROUND_SYNC_LIMIT)
            .map_err(|error| error.to_string())?
    };

    let mut processed = 0;
    let mut failed = 0;

    for job in jobs {
        let payload = google_payload_for_appointment(&job.appointment);
        let mut last_event_id = None;
        let mut last_error = None;

        for account in &accounts {
            let access_token = match access_token_for_account(&state, actor_user_id, account).await {
                Ok(access_token) => access_token,
                Err(error) => {
                    last_error = Some(error);
                    continue;
                }
            };
            let result = upsert_with_insert_fallback(
                &access_token,
                &account.calendar_id,
                job.appointment.google_calendar_event_id.as_deref(),
                &payload,
            )
            .await;
            match result {
                Ok(event_id) => last_event_id = Some(event_id),
                Err(error) => last_error = Some(error.to_string()),
            }
        }

        let database = state.database()?;
        if let Some(event_id) = last_event_id {
            database
                .complete_google_calendar_sync_job(job.job_id, job.appointment.id, &event_id)
                .map_err(|error| error.to_string())?;
            processed += 1;
        } else {
            database
                .retry_google_calendar_sync_job(
                    job.job_id,
                    last_error
                        .as_deref()
                        .unwrap_or("google calendar sync did not process any account"),
                )
                .map_err(|error| error.to_string())?;
            failed += 1;
        }
    }

    for job in block_jobs {
        let payload = google_payload_for_agenda_block(&job.block);
        let mut last_event_id = None;
        let mut last_error = None;

        for account in &accounts {
            let access_token = match access_token_for_account(&state, actor_user_id, account).await {
                Ok(access_token) => access_token,
                Err(error) => {
                    last_error = Some(error);
                    continue;
                }
            };
            let result = upsert_with_insert_fallback(
                &access_token,
                &account.calendar_id,
                job.block.google_calendar_event_id.as_deref(),
                &payload,
            )
            .await;
            match result {
                Ok(event_id) => last_event_id = Some(event_id),
                Err(error) => last_error = Some(error.to_string()),
            }
        }

        let database = state.database()?;
        if let Some(event_id) = last_event_id {
            database
                .complete_google_calendar_block_sync_job(job.job_id, job.block.id, &event_id)
                .map_err(|error| error.to_string())?;
            processed += 1;
        } else {
            database
                .retry_google_calendar_sync_job(
                    job.job_id,
                    last_error
                        .as_deref()
                        .unwrap_or("google calendar sync did not process any account"),
                )
                .map_err(|error| error.to_string())?;
            failed += 1;
        }
    }

    for account in &accounts {
        let access_token = match access_token_for_account(&state, actor_user_id, account).await {
            Ok(access_token) => access_token,
            Err(_) => {
                failed += 1;
                continue;
            }
        };
        match google::list_calendar_events(&access_token, &account.calendar_id).await {
            Ok(events) => {
                for event in events {
                    if event.status.as_deref() == Some("cancelled") {
                        let changed = {
                            let database = state.database()?;
                            database
                                .cancel_google_calendar_remote_appointment(
                                    actor_user_id,
                                    &event.id,
                                    event.updated.as_deref().unwrap_or(""),
                                )
                                .map_err(|error| error.to_string())?
                        };
                        if changed {
                            processed += 1;
                        }
                        continue;
                    }
                    let Some(starts_at) = event.start.date_time.as_deref() else {
                        continue;
                    };
                    let Some(ends_at) = event.end.date_time.as_deref() else {
                        continue;
                    };
                    let changed = {
                        let database = state.database()?;
                        database
                            .upsert_google_calendar_remote_appointment(
                                actor_user_id,
                                &event.id,
                                event.summary.as_deref().unwrap_or("Google Calendar"),
                                starts_at,
                                ends_at,
                                event.updated.as_deref().unwrap_or(""),
                            )
                            .map_err(|error| error.to_string())?
                    };
                    if changed {
                        processed += 1;
                    }
                }
            }
            Err(_) => {
                failed += 1;
            }
        }
    }

    Ok((processed, failed))
}

async fn access_token_for_account(
    state: &AppState,
    actor_user_id: i64,
    account: &GoogleCalendarTokenRecord,
) -> Result<String, String> {
    let token = serde_json::from_str::<google::GoogleCalendarToken>(&account.token_json)
        .map_err(|_| "stored google calendar token is not readable".to_owned())?;
    if token.access_token.trim().is_empty() {
        return Err("stored google calendar token is empty".to_owned());
    }
    if !token.should_refresh() {
        return Ok(token.access_token);
    }

    let refreshed = google::refresh_access_token(&token)
        .await
        .map_err(|error| error.to_string())?;
    if refreshed.access_token.trim().is_empty() {
        return Err("refreshed google calendar token is empty".to_owned());
    }
    let token_json = serde_json::to_string(&refreshed).map_err(|error| error.to_string())?;
    let database = state.database()?;
    database
        .update_google_calendar_account_token(actor_user_id, account.account_id, &token_json)
        .map_err(|error| error.to_string())?;
    Ok(refreshed.access_token)
}

async fn upsert_with_insert_fallback(
    access_token: &str,
    calendar_id: &str,
    existing_event_id: Option<&str>,
    payload: &google::GoogleCalendarEventPayload,
) -> Result<String, google::GoogleApiError> {
    match google::upsert_calendar_event(access_token, calendar_id, existing_event_id, payload).await
    {
        Ok(event_id) => Ok(event_id),
        Err(error) if existing_event_id.is_some() => {
            eprintln!("VeloDent calendar event update failed, retrying insert: {error}");
            google::upsert_calendar_event(access_token, calendar_id, None, payload).await
        }
        Err(error) => Err(error),
    }
}

fn google_payload_for_appointment(appointment: &Appointment) -> google::GoogleCalendarEventPayload {
    let summary = appointment
        .patient_name
        .as_ref()
        .map(|patient_name| format!("{patient_name} - {} (VeloDent)", appointment.title))
        .unwrap_or_else(|| format!("{} (VeloDent)", appointment.title));

    google::GoogleCalendarEventPayload {
        summary,
        description: "VeloDent agenda sync".to_owned(),
        start: google::GoogleCalendarEventDateTime {
            date_time: appointment.starts_at.clone(),
            time_zone: "Europe/Rome".to_owned(),
        },
        end: google::GoogleCalendarEventDateTime {
            date_time: appointment.ends_at.clone(),
            time_zone: "Europe/Rome".to_owned(),
        },
    }
}

fn google_payload_for_agenda_block(block: &AgendaBlock) -> google::GoogleCalendarEventPayload {
    google::GoogleCalendarEventPayload {
        summary: format!("{} (VeloDent)", block.title),
        description: "VeloDent busy/closed time".to_owned(),
        start: google::GoogleCalendarEventDateTime {
            date_time: block.starts_at.clone(),
            time_zone: "Europe/Rome".to_owned(),
        },
        end: google::GoogleCalendarEventDateTime {
            date_time: block.ends_at.clone(),
            time_zone: "Europe/Rome".to_owned(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appointment_payload_never_includes_clinical_notes() {
        let appointment = Appointment {
            id: 1,
            patient_id: Some(10),
            patient_name: Some("Rossi Mario".to_owned()),
            chair_number: 1,
            title: "Visita di controllo".to_owned(),
            starts_at: "2026-06-22T09:00:00Z".to_owned(),
            ends_at: "2026-06-22T09:30:00Z".to_owned(),
            status: "booked".to_owned(),
            color_tag: None,
            google_calendar_event_id: None,
            last_google_sync_at: None,
            created_at: "2026-06-22T08:00:00Z".to_owned(),
            updated_at: "2026-06-22T08:00:00Z".to_owned(),
        };

        let payload = google_payload_for_appointment(&appointment);

        assert_eq!(payload.summary, "Rossi Mario - Visita di controllo (VeloDent)");
        assert_eq!(payload.description, "VeloDent agenda sync");
    }
}
