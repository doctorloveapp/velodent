use crate::{
    auth::Role,
    db::{
        Appointment, AppointmentInput, AuthSession, AuthorizedDevice, AuthorizedGoogleAccount,
        BootstrapStatus, ChairConfig, ClinicalRecord, ClinicalRecordFilters, ClinicalService,
        CreateUserInput, DatabaseStatus, DeviceAuthorization, GoogleCalendarSyncStatus,
        LicenseStatus, NewClinicalRecord, NewPatient, Patient, PatientTimelineEvent,
        StudioSettings, StudioSettingsUpdate, ToothStatus, User,
    },
    integrations::google::{self, GoogleAuthorizationUrl, GoogleOAuthStatus},
    state::AppState,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[tauri::command]
pub fn database_status(state: State<'_, AppState>) -> Result<DatabaseStatus, String> {
    require_license(&state)?;
    state
        .database()?
        .status()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_test_patient(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<Patient, String> {
    require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .upsert_test_patient()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_patients(
    state: State<'_, AppState>,
    request: SearchPatientsRequest,
) -> Result<Vec<Patient>, String> {
    require_session(&state, &request.session_token)?;
    state
        .database()?
        .search_patients(&request.query, request.limit.unwrap_or(10))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn ensure_development_patient(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<Patient, String> {
    require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .ensure_development_patient()
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct SearchPatientsRequest {
    session_token: String,
    query: String,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ActivateLicenseRequest {
    activation_key: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateFirstAdminRequest {
    username: String,
    password: String,
    google_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleLoginAuthorizationUrlRequest {
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeGoogleLoginCodeRequest {
    code: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    session_token: String,
    username: String,
    password: Option<String>,
    google_email: Option<String>,
    role: Role,
}

#[derive(Debug, Deserialize)]
pub struct AddGoogleAccountRequest {
    session_token: String,
    email: String,
    role: Role,
}

#[derive(Debug, Deserialize)]
pub struct AuthorizeDeviceRequest {
    session_token: String,
    user_id: Option<i64>,
    label: String,
    allowed_lan_cidr: Option<String>,
    expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RevokeDeviceRequest {
    session_token: String,
    device_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStudioSettingsRequest {
    session_token: String,
    clinic_name: Option<String>,
    logo_relative_path: Option<String>,
    chair_count: i64,
    data_directory: Option<String>,
    holiday_periods_json: String,
}

#[derive(Debug, Deserialize)]
pub struct PatientRequest {
    session_token: String,
    first_name: String,
    last_name: String,
    tax_code: String,
    date_of_birth: String,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePatientRequest {
    session_token: String,
    patient_id: i64,
    first_name: String,
    last_name: String,
    tax_code: String,
    date_of_birth: String,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PatientIdRequest {
    session_token: String,
    patient_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct ValidateTaxCodeRequest {
    tax_code: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleOAuthStatusRequest {
    session_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ActorRequest {
    session_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ClinicalViewRequest {
    session_token: String,
    patient_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct SetToothStatusRequest {
    session_token: String,
    patient_id: i64,
    tooth_number: i64,
    state: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateClinicalRecordRequest {
    session_token: String,
    patient_id: i64,
    service_id: Option<i64>,
    tooth_number: Option<i64>,
    tooth_surface: Option<String>,
    pathology_description: Option<String>,
    status: String,
    ready_for_quote: bool,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListClinicalRecordsRequest {
    session_token: String,
    patient_id: i64,
    date_from: Option<String>,
    date_to: Option<String>,
    tooth_number: Option<i64>,
    operator_user_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct MarkClinicalRecordQuoteRequest {
    session_token: String,
    record_id: i64,
    ready_for_quote: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListAppointmentsRequest {
    session_token: String,
    starts_from: String,
    starts_to: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAppointmentRequest {
    session_token: String,
    patient_id: Option<i64>,
    chair_number: i64,
    title: String,
    starts_at: String,
    ends_at: String,
    status: String,
    color_tag: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveAppointmentRequest {
    session_token: String,
    appointment_id: i64,
    chair_number: i64,
    starts_at: String,
    ends_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAppointmentStatusRequest {
    session_token: String,
    appointment_id: i64,
    status: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleAuthorizationUrlRequest {
    session_token: String,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeGoogleOAuthCodeRequest {
    session_token: String,
    code: String,
}

#[derive(Debug, Deserialize)]
pub struct ProcessGoogleCalendarSyncRequest {
    session_token: String,
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct GoogleCalendarSyncRunResult {
    processed: i64,
    failed: i64,
}

fn require_session(state: &State<'_, AppState>, session_token: &str) -> Result<User, String> {
    require_license(state)?;
    state
        .database()?
        .user_for_session(session_token)
        .map_err(|error| error.to_string())
}

fn require_admin_session(state: &State<'_, AppState>, session_token: &str) -> Result<User, String> {
    let user = require_session(state, session_token)?;
    if user.role.is_admin() {
        Ok(user)
    } else {
        Err("operation requires admin privileges".to_owned())
    }
}

fn require_license(state: &State<'_, AppState>) -> Result<(), String> {
    let licensed = state
        .database()?
        .has_valid_license()
        .map_err(|error| error.to_string())?;
    if licensed {
        Ok(())
    } else {
        Err("software is not activated".to_owned())
    }
}

#[tauri::command]
pub fn license_status(state: State<'_, AppState>) -> Result<LicenseStatus, String> {
    state
        .database()?
        .license_status()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn activate_license(
    state: State<'_, AppState>,
    request: ActivateLicenseRequest,
) -> Result<LicenseStatus, String> {
    state
        .database()?
        .activate_license(request.activation_key.trim())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn bootstrap_status(state: State<'_, AppState>) -> Result<BootstrapStatus, String> {
    require_license(&state)?;
    state
        .database()?
        .bootstrap_status()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_first_admin(
    state: State<'_, AppState>,
    request: CreateFirstAdminRequest,
) -> Result<AuthSession, String> {
    require_license(&state)?;
    let database = state.database()?;
    let user = database
        .create_first_admin(
            request.username.trim(),
            &request.password,
            request.google_email.as_deref(),
        )
        .map_err(|error| error.to_string())?;
    database
        .create_session(user.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn login(state: State<'_, AppState>, request: LoginRequest) -> Result<AuthSession, String> {
    require_license(&state)?;
    let database = state.database()?;
    let user = database
        .login(request.username.trim(), &request.password)
        .map_err(|error| error.to_string())?;
    database
        .create_session(user.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn google_login_authorization_url(
    request: GoogleLoginAuthorizationUrlRequest,
) -> Result<GoogleAuthorizationUrl, String> {
    google::authorization_url(request.state.as_deref().unwrap_or("velodent-login"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn exchange_google_login_code(
    state: State<'_, AppState>,
    request: ExchangeGoogleLoginCodeRequest,
) -> Result<AuthSession, String> {
    require_license(&state)?;
    let token = google::exchange_authorization_code(request.code.trim())
        .await
        .map_err(|error| error.to_string())?;
    let user_info = google::user_info(&token.access_token)
        .await
        .map_err(|error| error.to_string())?;
    if !user_info.email_verified.unwrap_or(false) {
        return Err("google email is not verified".to_owned());
    }

    let database = state.database()?;
    let user = database
        .login_with_google_email(&user_info.email)
        .map_err(|error| error.to_string())?;
    database
        .create_session(user.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_user(state: State<'_, AppState>, request: CreateUserRequest) -> Result<User, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .create_user(
            actor.id,
            &CreateUserInput {
                username: request.username.trim(),
                password: request.password.as_deref(),
                google_email: request.google_email.as_deref(),
                role: request.role,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_users(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<Vec<User>, String> {
    require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .list_users()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_authorized_google_account(
    state: State<'_, AppState>,
    request: AddGoogleAccountRequest,
) -> Result<AuthorizedGoogleAccount, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .add_authorized_google_account(actor.id, request.email.trim(), request.role)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_authorized_google_accounts(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<Vec<AuthorizedGoogleAccount>, String> {
    require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .list_authorized_google_accounts()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn authorize_device(
    state: State<'_, AppState>,
    request: AuthorizeDeviceRequest,
) -> Result<DeviceAuthorization, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .authorize_device(
            actor.id,
            request.user_id,
            request.label.trim(),
            request.allowed_lan_cidr.as_deref(),
            request.expires_at.as_deref(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn revoke_device(
    state: State<'_, AppState>,
    request: RevokeDeviceRequest,
) -> Result<AuthorizedDevice, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .revoke_device(actor.id, request.device_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_devices(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<Vec<AuthorizedDevice>, String> {
    require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .list_devices()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_studio_settings(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<StudioSettings, String> {
    require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .studio_settings()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_studio_settings(
    state: State<'_, AppState>,
    request: UpdateStudioSettingsRequest,
) -> Result<StudioSettings, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .update_studio_settings(
            actor.id,
            &StudioSettingsUpdate {
                clinic_name: request.clinic_name.as_deref(),
                logo_relative_path: request.logo_relative_path.as_deref(),
                chair_count: request.chair_count,
                data_directory: request.data_directory.as_deref(),
                holiday_periods_json: &request.holiday_periods_json,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn google_oauth_status(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<GoogleOAuthStatus, String> {
    require_admin_session(&state, &request.session_token)?;
    Ok(google::oauth_status())
}

#[tauri::command]
pub fn google_calendar_sync_status(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<GoogleCalendarSyncStatus, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .google_calendar_sync_status(actor.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn google_calendar_authorization_url(
    state: State<'_, AppState>,
    request: GoogleAuthorizationUrlRequest,
) -> Result<GoogleAuthorizationUrl, String> {
    require_admin_session(&state, &request.session_token)?;
    google::authorization_url(request.state.as_deref().unwrap_or("velodent-local"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn exchange_google_oauth_code(
    state: State<'_, AppState>,
    request: ExchangeGoogleOAuthCodeRequest,
) -> Result<GoogleCalendarSyncStatus, String> {
    let actor = require_admin_session(&state, &request.session_token)?;

    let token = google::exchange_authorization_code(request.code.trim())
        .await
        .map_err(|error| error.to_string())?;
    let token_json = serde_json::to_string(&token).map_err(|error| error.to_string())?;
    let database = state.database()?;
    database
        .store_google_calendar_token(actor.id, &token_json)
        .map_err(|error| error.to_string())?;
    database
        .google_calendar_sync_status(actor.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn validate_tax_code(request: ValidateTaxCodeRequest) -> bool {
    crate::db::validate_tax_code(&request.tax_code)
}

#[tauri::command]
pub fn get_chair_config(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<ChairConfig, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .chair_config(actor.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_appointments(
    state: State<'_, AppState>,
    request: ListAppointmentsRequest,
) -> Result<Vec<Appointment>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_appointments(
            actor.id,
            request.starts_from.trim(),
            request.starts_to.trim(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_appointment(
    state: State<'_, AppState>,
    request: CreateAppointmentRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .create_appointment(
            actor.id,
            &AppointmentInput {
                patient_id: request.patient_id,
                chair_number: request.chair_number,
                title: request.title.trim(),
                starts_at: request.starts_at.trim(),
                ends_at: request.ends_at.trim(),
                status: request.status.trim(),
                color_tag: request.color_tag.as_deref(),
                notes: request.notes.as_deref(),
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn move_appointment(
    state: State<'_, AppState>,
    request: MoveAppointmentRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .move_appointment(
            actor.id,
            request.appointment_id,
            request.starts_at.trim(),
            request.ends_at.trim(),
            request.chair_number,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_appointment_status(
    state: State<'_, AppState>,
    request: UpdateAppointmentStatusRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .update_appointment_status(actor.id, request.appointment_id, request.status.trim())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_patient(
    state: State<'_, AppState>,
    request: PatientRequest,
) -> Result<Patient, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .create_patient(
            actor.id,
            &NewPatient {
                first_name: request.first_name.trim(),
                last_name: request.last_name.trim(),
                tax_code: request.tax_code.trim(),
                date_of_birth: request.date_of_birth.trim(),
                phone: request.phone.as_deref(),
                email: request.email.as_deref(),
                address: request.address.as_deref(),
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_patient(
    state: State<'_, AppState>,
    request: UpdatePatientRequest,
) -> Result<Patient, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .update_patient(
            actor.id,
            request.patient_id,
            &NewPatient {
                first_name: request.first_name.trim(),
                last_name: request.last_name.trim(),
                tax_code: request.tax_code.trim(),
                date_of_birth: request.date_of_birth.trim(),
                phone: request.phone.as_deref(),
                email: request.email.as_deref(),
                address: request.address.as_deref(),
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_patient(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Patient, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .delete_patient(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_patient_record(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Patient, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .open_patient_record(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn patient_timeline(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Vec<PatientTimelineEvent>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .patient_timeline(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_clinical_services(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<Vec<ClinicalService>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_clinical_services(actor.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_clinical_view(
    state: State<'_, AppState>,
    request: ClinicalViewRequest,
) -> Result<(), String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .open_clinical_view(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_tooth_statuses(
    state: State<'_, AppState>,
    request: ClinicalViewRequest,
) -> Result<Vec<ToothStatus>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .get_tooth_statuses(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tooth_status(
    state: State<'_, AppState>,
    request: SetToothStatusRequest,
) -> Result<ToothStatus, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .set_tooth_status(
            actor.id,
            request.patient_id,
            request.tooth_number,
            request.state.trim(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_clinical_record(
    state: State<'_, AppState>,
    request: CreateClinicalRecordRequest,
) -> Result<ClinicalRecord, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .create_clinical_record(
            actor.id,
            &NewClinicalRecord {
                patient_id: request.patient_id,
                service_id: request.service_id,
                tooth_number: request.tooth_number,
                tooth_surface: request.tooth_surface.as_deref(),
                pathology_description: request.pathology_description.as_deref(),
                status: request.status.trim(),
                ready_for_quote: request.ready_for_quote,
                notes: request.notes.as_deref(),
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_clinical_records(
    state: State<'_, AppState>,
    request: ListClinicalRecordsRequest,
) -> Result<Vec<ClinicalRecord>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_clinical_records(
            actor.id,
            request.patient_id,
            &ClinicalRecordFilters {
                date_from: request.date_from.as_deref(),
                date_to: request.date_to.as_deref(),
                tooth_number: request.tooth_number,
                operator_user_id: request.operator_user_id,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mark_clinical_record_ready_for_quote(
    state: State<'_, AppState>,
    request: MarkClinicalRecordQuoteRequest,
) -> Result<ClinicalRecord, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .mark_clinical_record_ready_for_quote(actor.id, request.record_id, request.ready_for_quote)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn process_google_calendar_sync(
    state: State<'_, AppState>,
    request: ProcessGoogleCalendarSyncRequest,
) -> Result<GoogleCalendarSyncRunResult, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    let token_json = {
        let database = state.database()?;
        database
            .google_calendar_token_json(actor.id)
            .map_err(|error| error.to_string())?
    };
    let token = serde_json::from_str::<google::GoogleCalendarToken>(&token_json)
        .map_err(|_| "stored google calendar token is not readable".to_owned())?;
    if token.access_token.trim().is_empty() {
        return Err("stored google calendar token is empty".to_owned());
    }

    let jobs = {
        let database = state.database()?;
        database
            .pending_google_calendar_sync_jobs(actor.id, request.limit.unwrap_or(10))
            .map_err(|error| error.to_string())?
    };

    let mut processed = 0;
    let mut failed = 0;
    for job in jobs {
        let payload = google_payload_for_appointment(&job.appointment);
        let result = google::upsert_calendar_event(
            &token.access_token,
            "primary",
            job.appointment.google_calendar_event_id.as_deref(),
            &payload,
        )
        .await;

        let database = state.database()?;
        match result {
            Ok(event_id) => {
                database
                    .complete_google_calendar_sync_job(
                        job.job_id,
                        job.appointment.id,
                        event_id.trim(),
                    )
                    .map_err(|error| error.to_string())?;
                processed += 1;
            }
            Err(error) => {
                database
                    .fail_google_calendar_sync_job(job.job_id, &error.to_string())
                    .map_err(|db_error| db_error.to_string())?;
                failed += 1;
            }
        }
    }

    Ok(GoogleCalendarSyncRunResult { processed, failed })
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
