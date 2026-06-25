use crate::{
    db::{AgendaBlock, Appointment, GoogleCalendarEventLinkRecord, GoogleCalendarTokenRecord},
    integrations::google,
    state::AppState,
};
use std::collections::HashSet;
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
    let outbound_account = accounts
        .iter()
        .min_by_key(|account| account.account_id)
        .cloned();
    let use_legacy_google_event_id = accounts.len() == 1;

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
    let (remote_processed, remote_failed) =
        pull_remote_google_calendar_events(&state, actor_user_id, &accounts).await?;
    processed += remote_processed;
    failed += remote_failed;
    let mut seen_appointments = HashSet::new();

    for job in jobs {
        if !seen_appointments.insert(job.appointment.id) {
            continue;
        }
        if job.appointment.status == "cancelled" {
            match delete_google_events_for_entity(
                &state,
                actor_user_id,
                "appointment",
                job.appointment.id,
                job.appointment.google_calendar_event_id.as_deref(),
                outbound_account.as_ref(),
            )
            .await
            {
                Ok(()) => {
                    let database = state.database()?;
                    database
                        .complete_google_calendar_delete_sync_job(job.job_id, job.appointment.id)
                        .map_err(|error| error.to_string())?;
                    processed += 1;
                }
                Err(error) => {
                    let database = state.database()?;
                    database
                        .retry_google_calendar_sync_job(job.job_id, &error)
                        .map_err(|error| error.to_string())?;
                    failed += 1;
                }
            }
            continue;
        }
        let payload = google_payload_for_appointment(&job.appointment);
        let mut last_event_id = None;
        let mut last_error = None;

        if let Some(account) = outbound_account.as_ref() {
            let access_token = match access_token_for_account(&state, actor_user_id, account).await
            {
                Ok(access_token) => access_token,
                Err(error) => {
                    last_error = Some(error);
                    String::new()
                }
            };
            if !access_token.is_empty() {
                let existing_event_id = {
                    let database = state.database()?;
                    database
                        .google_calendar_event_id_for(
                            actor_user_id,
                            account.account_id,
                            "appointment",
                            job.appointment.id,
                        )
                        .map_err(|error| error.to_string())?
                }
                .or_else(|| {
                    use_legacy_google_event_id
                        .then(|| job.appointment.google_calendar_event_id.clone())
                        .flatten()
                });
                let result = upsert_with_insert_fallback(
                    &access_token,
                    &account.calendar_id,
                    existing_event_id.as_deref(),
                    &payload,
                )
                .await;
                match result {
                    Ok(event_id) => {
                        let database = state.database()?;
                        database
                            .store_google_calendar_event_link(
                                actor_user_id,
                                account.account_id,
                                "appointment",
                                job.appointment.id,
                                &event_id,
                            )
                            .map_err(|error| error.to_string())?;
                        last_event_id = Some(event_id);
                    }
                    Err(error) => last_error = Some(error.to_string()),
                }
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

    let mut seen_blocks = HashSet::new();
    for job in block_jobs {
        if !seen_blocks.insert(job.block.id) {
            continue;
        }
        let payload = google_payload_for_agenda_block(&job.block);
        let mut last_event_id = None;
        let mut last_error = None;

        if let Some(account) = outbound_account.as_ref() {
            let access_token = match access_token_for_account(&state, actor_user_id, account).await
            {
                Ok(access_token) => access_token,
                Err(error) => {
                    last_error = Some(error);
                    String::new()
                }
            };
            if !access_token.is_empty() {
                let existing_event_id = {
                    let database = state.database()?;
                    database
                        .google_calendar_event_id_for(
                            actor_user_id,
                            account.account_id,
                            "agenda_block",
                            job.block.id,
                        )
                        .map_err(|error| error.to_string())?
                }
                .or_else(|| {
                    use_legacy_google_event_id
                        .then(|| job.block.google_calendar_event_id.clone())
                        .flatten()
                });
                let result = upsert_with_insert_fallback(
                    &access_token,
                    &account.calendar_id,
                    existing_event_id.as_deref(),
                    &payload,
                )
                .await;
                match result {
                    Ok(event_id) => {
                        let database = state.database()?;
                        database
                            .store_google_calendar_event_link(
                                actor_user_id,
                                account.account_id,
                                "agenda_block",
                                job.block.id,
                                &event_id,
                            )
                            .map_err(|error| error.to_string())?;
                        last_event_id = Some(event_id);
                    }
                    Err(error) => last_error = Some(error.to_string()),
                }
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

    Ok((processed, failed))
}

async fn pull_remote_google_calendar_events(
    state: &AppState,
    actor_user_id: i64,
    accounts: &[GoogleCalendarTokenRecord],
) -> Result<(i64, i64), String> {
    let mut processed = 0;
    let mut failed = 0;
    for account in accounts {
        let access_token = match access_token_for_account(state, actor_user_id, account).await {
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
                    let starts_at = normalize_google_datetime_for_storage(starts_at)
                        .unwrap_or_else(|| starts_at.to_owned());
                    let ends_at = normalize_google_datetime_for_storage(ends_at)
                        .unwrap_or_else(|| ends_at.to_owned());
                    let changed = {
                        let database = state.database()?;
                        database
                            .upsert_google_calendar_remote_appointment(
                                actor_user_id,
                                account.account_id,
                                &event.id,
                                event.summary.as_deref().unwrap_or("Google Calendar"),
                                &starts_at,
                                &ends_at,
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

async fn access_token_for_event_link(
    state: &AppState,
    actor_user_id: i64,
    link: &GoogleCalendarEventLinkRecord,
) -> Result<String, String> {
    let token = serde_json::from_str::<google::GoogleCalendarToken>(&link.token_json)
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
        .update_google_calendar_account_token(actor_user_id, link.account_id, &token_json)
        .map_err(|error| error.to_string())?;
    Ok(refreshed.access_token)
}

async fn delete_google_events_for_entity(
    state: &AppState,
    actor_user_id: i64,
    entity_type: &str,
    entity_id: i64,
    legacy_event_id: Option<&str>,
    fallback_account: Option<&GoogleCalendarTokenRecord>,
) -> Result<(), String> {
    let links = {
        let database = state.database()?;
        database
            .google_calendar_event_links_for(actor_user_id, entity_type, entity_id)
            .map_err(|error| error.to_string())?
    };
    let mut last_error = None;
    for link in &links {
        let access_token = match access_token_for_event_link(state, actor_user_id, link).await {
            Ok(access_token) => access_token,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        if let Err(error) =
            google::delete_calendar_event(&access_token, &link.calendar_id, &link.google_event_id)
                .await
        {
            last_error = Some(format!(
                "account {} calendar delete failed: {error}",
                link.account_id
            ));
        }
    }
    if links.is_empty() {
        if let (Some(event_id), Some(account)) = (
            legacy_event_id.and_then(|event_id| {
                let trimmed = event_id.trim();
                (!trimmed.is_empty()).then_some(trimmed)
            }),
            fallback_account,
        ) {
            let access_token = access_token_for_account(state, actor_user_id, account).await?;
            google::delete_calendar_event(&access_token, &account.calendar_id, event_id)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    if let Some(error) = last_error {
        if links.is_empty() {
            return Ok(());
        }
        return Err(error);
    }
    let database = state.database()?;
    database
        .delete_google_calendar_event_links_for(actor_user_id, entity_type, entity_id)
        .map_err(|error| error.to_string())?;
    Ok(())
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

fn normalize_google_datetime_for_storage(value: &str) -> Option<String> {
    let parsed = parse_rfc3339_datetime(value)?;
    let utc_seconds = epoch_seconds_from_civil(
        parsed.year,
        parsed.month,
        parsed.day,
        parsed.hour,
        parsed.minute,
        parsed.second,
    ) - i64::from(parsed.offset_minutes) * 60;
    let local_offset_minutes = europe_rome_offset_minutes(utc_seconds);
    let local_seconds = utc_seconds + i64::from(local_offset_minutes) * 60;
    let (year, month, day, hour, minute, second) = civil_from_epoch_seconds(local_seconds);
    let sign = if local_offset_minutes >= 0 { '+' } else { '-' };
    let absolute_offset = local_offset_minutes.abs();
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}{sign}{:02}:{:02}",
        absolute_offset / 60,
        absolute_offset % 60
    ))
}

#[derive(Clone, Copy)]
struct ParsedRfc3339DateTime {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    offset_minutes: i32,
}

fn parse_rfc3339_datetime(value: &str) -> Option<ParsedRfc3339DateTime> {
    let (date_part, time_part) = value.trim().split_once('T')?;
    let mut date = date_part.split('-');
    let year = date.next()?.parse().ok()?;
    let month = date.next()?.parse().ok()?;
    let day = date.next()?.parse().ok()?;
    if date.next().is_some() {
        return None;
    }

    let (time_part, offset_minutes) = if let Some(time) = time_part.strip_suffix('Z') {
        (time, 0)
    } else if let Some(index) = time_part.rfind('+') {
        (
            &time_part[..index],
            parse_offset_minutes(&time_part[index..])?,
        )
    } else if let Some(index) = time_part.rfind('-') {
        (
            &time_part[..index],
            parse_offset_minutes(&time_part[index..])?,
        )
    } else {
        return None;
    };

    let mut time = time_part.split(':');
    let hour = time.next()?.parse().ok()?;
    let minute = time.next()?.parse().ok()?;
    let second_part = time.next()?;
    if time.next().is_some() {
        return None;
    }
    let second = second_part.split('.').next()?.parse().ok()?;
    Some(ParsedRfc3339DateTime {
        year,
        month,
        day,
        hour,
        minute,
        second,
        offset_minutes,
    })
}

fn parse_offset_minutes(value: &str) -> Option<i32> {
    let sign = if value.starts_with('-') { -1 } else { 1 };
    let offset = value.trim_start_matches(['+', '-']);
    let (hours, minutes) = offset.split_once(':')?;
    Some(sign * (hours.parse::<i32>().ok()? * 60 + minutes.parse::<i32>().ok()?))
}

fn europe_rome_offset_minutes(utc_seconds: i64) -> i32 {
    let (year, _, _, _, _, _) = civil_from_epoch_seconds(utc_seconds);
    let dst_start = epoch_seconds_from_civil(year, 3, last_sunday_of_month(year, 3), 1, 0, 0);
    let dst_end = epoch_seconds_from_civil(year, 10, last_sunday_of_month(year, 10), 1, 0, 0);
    if utc_seconds >= dst_start && utc_seconds < dst_end {
        120
    } else {
        60
    }
}

fn last_sunday_of_month(year: i32, month: u32) -> u32 {
    let last_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 30,
    };
    let weekday = (days_from_civil(year, month, last_day) + 4).rem_euclid(7);
    last_day - weekday as u32
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn epoch_seconds_from_civil(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> i64 {
    days_from_civil(year, month, day) * 86_400
        + i64::from(hour) * 3_600
        + i64::from(minute) * 60
        + i64::from(second)
}

fn civil_from_epoch_seconds(seconds: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = (seconds_of_day / 3_600) as u32;
    let minute = ((seconds_of_day % 3_600) / 60) as u32;
    let second = (seconds_of_day % 60) as u32;
    (year, month, day, hour, minute, second)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_prime = month as i32 + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day as i32 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    i64::from(era) * 146_097 + i64::from(day_of_era) - 719_468
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era as i32 + era as i32 * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i32::from(month <= 2);
    (year, month as u32, day as u32)
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

        assert_eq!(
            payload.summary,
            "Rossi Mario - Visita di controllo (VeloDent)"
        );
        assert_eq!(payload.description, "VeloDent agenda sync");
    }

    #[test]
    fn google_utc_datetime_is_stored_as_europe_rome_summer_time() {
        assert_eq!(
            normalize_google_datetime_for_storage("2026-06-24T10:00:00Z").as_deref(),
            Some("2026-06-24T12:00:00+02:00")
        );
    }

    #[test]
    fn google_utc_datetime_is_stored_as_europe_rome_winter_time() {
        assert_eq!(
            normalize_google_datetime_for_storage("2026-01-10T08:30:00Z").as_deref(),
            Some("2026-01-10T09:30:00+01:00")
        );
    }
}
