use crate::{
    auth::Role,
    db::{
        AuthorizedDevice, AuthorizedGoogleAccount, BootstrapStatus, CreateUserInput,
        DatabaseStatus, DeviceAuthorization, NewPatient, Patient, PatientTimelineEvent,
        StudioSettings, StudioSettingsUpdate, User,
    },
    integrations::google::{self, GoogleOAuthStatus},
    state::AppState,
};
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub fn database_status(state: State<'_, AppState>) -> Result<DatabaseStatus, String> {
    state
        .database()?
        .status()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_test_patient(state: State<'_, AppState>) -> Result<Patient, String> {
    state
        .database()?
        .upsert_test_patient()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_patients(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Patient>, String> {
    state
        .database()?
        .search_patients(&query, limit.unwrap_or(10))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn ensure_development_patient(state: State<'_, AppState>) -> Result<Patient, String> {
    state
        .database()?
        .ensure_development_patient()
        .map_err(|error| error.to_string())
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
pub struct CreateUserRequest {
    actor_user_id: i64,
    username: String,
    password: Option<String>,
    google_email: Option<String>,
    role: Role,
}

#[derive(Debug, Deserialize)]
pub struct AddGoogleAccountRequest {
    actor_user_id: i64,
    email: String,
    role: Role,
}

#[derive(Debug, Deserialize)]
pub struct AuthorizeDeviceRequest {
    actor_user_id: i64,
    user_id: Option<i64>,
    label: String,
    allowed_lan_cidr: Option<String>,
    expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RevokeDeviceRequest {
    actor_user_id: i64,
    device_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStudioSettingsRequest {
    actor_user_id: i64,
    clinic_name: Option<String>,
    logo_relative_path: Option<String>,
    chair_count: i64,
    data_directory: Option<String>,
    holiday_periods_json: String,
}

#[derive(Debug, Deserialize)]
pub struct PatientRequest {
    actor_user_id: i64,
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
    actor_user_id: i64,
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
    actor_user_id: i64,
    patient_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct ValidateTaxCodeRequest {
    tax_code: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleOAuthStatusRequest {
    actor_user_id: i64,
}

#[tauri::command]
pub fn bootstrap_status(state: State<'_, AppState>) -> Result<BootstrapStatus, String> {
    state
        .database()?
        .bootstrap_status()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_first_admin(
    state: State<'_, AppState>,
    request: CreateFirstAdminRequest,
) -> Result<User, String> {
    state
        .database()?
        .create_first_admin(
            request.username.trim(),
            &request.password,
            request.google_email.as_deref(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn login(state: State<'_, AppState>, request: LoginRequest) -> Result<User, String> {
    state
        .database()?
        .login(request.username.trim(), &request.password)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_user(state: State<'_, AppState>, request: CreateUserRequest) -> Result<User, String> {
    state
        .database()?
        .create_user(
            request.actor_user_id,
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
pub fn list_users(state: State<'_, AppState>) -> Result<Vec<User>, String> {
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
    state
        .database()?
        .add_authorized_google_account(request.actor_user_id, request.email.trim(), request.role)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_authorized_google_accounts(
    state: State<'_, AppState>,
) -> Result<Vec<AuthorizedGoogleAccount>, String> {
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
    state
        .database()?
        .authorize_device(
            request.actor_user_id,
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
    state
        .database()?
        .revoke_device(request.actor_user_id, request.device_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_devices(state: State<'_, AppState>) -> Result<Vec<AuthorizedDevice>, String> {
    state
        .database()?
        .list_devices()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_studio_settings(state: State<'_, AppState>) -> Result<StudioSettings, String> {
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
    state
        .database()?
        .update_studio_settings(
            request.actor_user_id,
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
    state
        .database()?
        .assert_admin(request.actor_user_id)
        .map_err(|error| error.to_string())?;
    Ok(google::oauth_status())
}

#[tauri::command]
pub fn validate_tax_code(request: ValidateTaxCodeRequest) -> bool {
    crate::db::validate_tax_code(&request.tax_code)
}

#[tauri::command]
pub fn create_patient(
    state: State<'_, AppState>,
    request: PatientRequest,
) -> Result<Patient, String> {
    state
        .database()?
        .create_patient(
            request.actor_user_id,
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
    state
        .database()?
        .update_patient(
            request.actor_user_id,
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
    state
        .database()?
        .delete_patient(request.actor_user_id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_patient_record(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Patient, String> {
    state
        .database()?
        .open_patient_record(request.actor_user_id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn patient_timeline(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Vec<PatientTimelineEvent>, String> {
    state
        .database()?
        .patient_timeline(request.actor_user_id, request.patient_id)
        .map_err(|error| error.to_string())
}
