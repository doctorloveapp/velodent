use crate::{
    auth::Role,
    billing::{self, FinancialPdf, PdfLine, PdfParty},
    clinical::{self, BridgeUnits},
    db::{
        AgendaBlock, Appointment, AppointmentInput, AuthSession, AuthorizedDevice,
        AuthorizedGoogleAccount, BootstrapStatus, ChairConfig, ClinicalRecord,
        ClinicalRecordFilters, ClinicalService, CreateUserInput, DatabaseStatus,
        DeviceAuthorization, GeneratedDocument, GoogleCalendarSyncStatus, Invoice, LicenseStatus,
        NewAgendaBlock, NewClinicalRecord, NewPatient, NewRxAsset, Patient, PatientTimelineEvent,
        Payment, Quote, RxAsset, StudioSettings, StudioSettingsUpdate, ToothStatus, User,
    },
    dicom_meta, files,
    integrations::{
        google::{self, GoogleAuthorizationUrl, GoogleOAuthStatus},
        sumup::{self, SumupCheckout},
    },
    rx_acquisition::{MockRxAdapter, RxAcquisitionAdapter},
    server,
    state::{AppState, PairingCodeInfo},
    ts_cns::{self, TsCnsPatientData},
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    time::{Duration, Instant},
};
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
pub struct StartGoogleLoginRequest {
    state: Option<String>,
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
pub struct PairingCodeRequest {
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
pub struct DeleteClinicalRecordRequest {
    session_token: String,
    record_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct CalculateBridgeUnitsRequest {
    session_token: String,
    selected_teeth: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ImportRxFileRequest {
    session_token: String,
    patient_id: i64,
    source_path: String,
    rx_type: Option<String>,
    tooth_number: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ListRxAssetsRequest {
    session_token: String,
    patient_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct RxAssetDataUrlRequest {
    session_token: String,
    file_asset_id: i64,
}

#[derive(Debug, Serialize)]
pub struct RxAssetDataUrl {
    file_asset_id: i64,
    mime_type: String,
    data_url: String,
}

#[derive(Debug, Deserialize)]
pub struct MockAcquireRxRequest {
    session_token: String,
    patient_id: i64,
    rx_type: Option<String>,
    tooth_number: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ListAppointmentsRequest {
    session_token: String,
    starts_from: String,
    starts_to: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgendaBlockRequest {
    session_token: String,
    title: String,
    starts_at: String,
    ends_at: String,
    all_day: bool,
}

#[derive(Debug, Deserialize)]
pub struct DeleteAgendaBlockRequest {
    session_token: String,
    block_id: i64,
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
pub struct UpdateClinicalServicePriceRequest {
    session_token: String,
    service_id: i64,
    base_price_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateQuoteFromDiagnosisRequest {
    session_token: String,
    patient_id: i64,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddQuoteLineRequest {
    session_token: String,
    quote_id: i64,
    service_id: i64,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateQuoteDiscountRequest {
    session_token: String,
    quote_id: i64,
    discount_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateQuoteStatusRequest {
    session_token: String,
    quote_id: i64,
    status: String,
}

#[derive(Debug, Deserialize)]
pub struct QuoteIdRequest {
    session_token: String,
    quote_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct InvoiceIdRequest {
    session_token: String,
    invoice_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct RegisterPaymentRequest {
    session_token: String,
    invoice_id: i64,
    method: String,
    amount_cents: i64,
    status: String,
}

#[derive(Debug, Deserialize)]
pub struct StartSumupPaymentRequest {
    session_token: String,
    invoice_id: i64,
    method: String,
}

#[derive(Debug, Serialize)]
pub struct SumupPaymentStart {
    payment: Payment,
    checkout: SumupCheckout,
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
pub async fn start_google_login(
    state: State<'_, AppState>,
    request: StartGoogleLoginRequest,
) -> Result<AuthSession, String> {
    require_license(&state)?;
    let expected_state = request
        .state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("velodent-login")
        .to_owned();
    let authorization =
        google::authorization_url(&expected_state).map_err(|error| error.to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", 1421))
        .map_err(|error| format!("unable to start Google login listener on port 1421: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    opener::open(&authorization.authorization_url)
        .map_err(|error| format!("unable to open the default browser: {error}"))?;

    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_google_oauth_code(listener, &expected_state)
    })
    .await
    .map_err(|error| error.to_string())??;

    let token = google::exchange_authorization_code(code.trim())
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
pub fn get_pairing_code(
    state: State<'_, AppState>,
    request: PairingCodeRequest,
) -> Result<PairingCodeInfo, String> {
    let actor = require_session(&state, &request.session_token)?;
    let mut pairing_code = state.create_pairing_code(actor.id, server::lan::LAN_SERVER_PORT)?;
    match state.ensure_mobile_tunnel() {
        Ok(tunnel) => {
            pairing_code.public_url = Some(format!("{}?mobile=1", tunnel.public_url));
        }
        Err(error) => {
            pairing_code.tunnel_error = Some(error);
        }
    }
    Ok(pairing_code)
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
pub fn read_ts_cns(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<TsCnsPatientData, String> {
    let actor = require_session(&state, &request.session_token)?;
    let result = ts_cns::read_ts_cns_from_mobile_nfc();
    let audit_result = state
        .database()?
        .audit_ts_cns_scan(actor.id, result.is_ok())
        .map_err(|error| error.to_string());
    if let Err(error) = audit_result {
        return Err(error);
    }
    result
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
pub fn list_agenda_blocks(
    state: State<'_, AppState>,
    request: ListAppointmentsRequest,
) -> Result<Vec<AgendaBlock>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_agenda_blocks(
            actor.id,
            request.starts_from.trim(),
            request.starts_to.trim(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_agenda_block(
    state: State<'_, AppState>,
    request: CreateAgendaBlockRequest,
) -> Result<AgendaBlock, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .create_agenda_block(
            actor.id,
            &NewAgendaBlock {
                title: request.title.trim(),
                starts_at: request.starts_at.trim(),
                ends_at: request.ends_at.trim(),
                all_day: request.all_day,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_agenda_block(
    state: State<'_, AppState>,
    request: DeleteAgendaBlockRequest,
) -> Result<AgendaBlock, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .delete_agenda_block(actor.id, request.block_id)
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
pub fn update_clinical_service_price(
    state: State<'_, AppState>,
    request: UpdateClinicalServicePriceRequest,
) -> Result<ClinicalService, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .update_clinical_service_price(actor.id, request.service_id, request.base_price_cents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_quotes(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Vec<Quote>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_quotes(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_quote_from_diagnosis(
    state: State<'_, AppState>,
    request: CreateQuoteFromDiagnosisRequest,
) -> Result<Quote, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .create_quote_from_ready_records(
            actor.id,
            request.patient_id,
            request
                .title
                .as_deref()
                .unwrap_or("Preventivo odontoiatrico"),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_quote_line(
    state: State<'_, AppState>,
    request: AddQuoteLineRequest,
) -> Result<Quote, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .add_quote_line(
            actor.id,
            request.quote_id,
            request.service_id,
            request.quantity,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_quote_discount(
    state: State<'_, AppState>,
    request: UpdateQuoteDiscountRequest,
) -> Result<Quote, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .update_quote_discount(actor.id, request.quote_id, request.discount_cents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_quote_status(
    state: State<'_, AppState>,
    request: UpdateQuoteStatusRequest,
) -> Result<Quote, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .update_quote_status(actor.id, request.quote_id, request.status.trim())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_invoice_from_quote(
    state: State<'_, AppState>,
    request: QuoteIdRequest,
) -> Result<Invoice, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .create_invoice_from_quote(actor.id, request.quote_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_invoices(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Vec<Invoice>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_invoices(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn register_payment(
    state: State<'_, AppState>,
    request: RegisterPaymentRequest,
) -> Result<Payment, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .register_payment(
            actor.id,
            request.invoice_id,
            request.method.trim(),
            request.amount_cents,
            None,
            request.status.trim(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn generate_quote_pdf(
    state: State<'_, AppState>,
    request: QuoteIdRequest,
) -> Result<GeneratedDocument, String> {
    let actor = require_session(&state, &request.session_token)?;
    let database = state.database()?;
    let quote = database
        .get_quote_for_document(actor.id, request.quote_id)
        .map_err(|error| error.to_string())?;
    let patient = database
        .get_patient(quote.patient_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "patient not found".to_owned())?;
    let settings = database
        .studio_settings()
        .map_err(|error| error.to_string())?;
    let bytes = render_quote_pdf(&settings, &patient, &quote)?;
    let stored = files::store_patient_document_bytes(
        quote.patient_id,
        "quote",
        &format!("preventivo-{}", quote.id),
        &bytes,
    )?;
    database
        .register_generated_document(
            actor.id,
            quote.patient_id,
            "quote",
            &stored.relative_path,
            &stored.mime_type,
            &stored.sha256_hex,
            stored.size_bytes,
            &serde_json::json!({ "quote_id": quote.id }).to_string(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn generate_invoice_pdf(
    state: State<'_, AppState>,
    request: InvoiceIdRequest,
) -> Result<GeneratedDocument, String> {
    let actor = require_session(&state, &request.session_token)?;
    let database = state.database()?;
    let invoice = database
        .get_invoice_for_document(actor.id, request.invoice_id)
        .map_err(|error| error.to_string())?;
    let patient = database
        .get_patient(invoice.patient_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "patient not found".to_owned())?;
    let settings = database
        .studio_settings()
        .map_err(|error| error.to_string())?;
    let bytes = render_invoice_pdf(&settings, &patient, &invoice)?;
    let stored = files::store_patient_document_bytes(
        invoice.patient_id,
        "invoice",
        &format!(
            "fattura-{}-{}",
            invoice.invoice_number, invoice.invoice_year
        ),
        &bytes,
    )?;
    database
        .register_generated_document(
            actor.id,
            invoice.patient_id,
            "invoice",
            &stored.relative_path,
            &stored.mime_type,
            &stored.sha256_hex,
            stored.size_bytes,
            &serde_json::json!({ "invoice_id": invoice.id }).to_string(),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_sumup_payment(
    state: State<'_, AppState>,
    request: StartSumupPaymentRequest,
) -> Result<SumupPaymentStart, String> {
    let actor = require_session(&state, &request.session_token)?;
    let (invoice, amount_cents) = {
        let database = state.database()?;
        let invoice = database
            .get_invoice_for_document(actor.id, request.invoice_id)
            .map_err(|error| error.to_string())?;
        let amount_cents = database
            .invoice_balance_cents(actor.id, request.invoice_id)
            .map_err(|error| error.to_string())?;
        (invoice, amount_cents)
    };
    if amount_cents <= 0 {
        return Err("invoice is already paid".to_owned());
    }
    let method = match request.method.trim() {
        "sumup_pos" => "sumup_pos",
        _ => "sumup_link",
    };
    let checkout = sumup::create_checkout(
        invoice.id,
        amount_cents,
        &format!(
            "VeloDent fattura {}/{}",
            invoice.invoice_number, invoice.invoice_year
        ),
    )
    .await
    .map_err(|error| error.to_string())?;
    let payment = state
        .database()?
        .register_payment(
            actor.id,
            invoice.id,
            method,
            amount_cents,
            Some(&checkout.checkout_id),
            "pending",
        )
        .map_err(|error| error.to_string())?;
    Ok(SumupPaymentStart { payment, checkout })
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
pub fn delete_clinical_record(
    state: State<'_, AppState>,
    request: DeleteClinicalRecordRequest,
) -> Result<(), String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .delete_clinical_record(actor.id, request.record_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn calculate_bridge_units(
    state: State<'_, AppState>,
    request: CalculateBridgeUnitsRequest,
) -> Result<BridgeUnits, String> {
    require_session(&state, &request.session_token)?;
    clinical::calculate_bridge_units(&request.selected_teeth)
}

#[tauri::command]
pub fn import_rx_file(
    state: State<'_, AppState>,
    request: ImportRxFileRequest,
) -> Result<RxAsset, String> {
    let actor = require_session(&state, &request.session_token)?;
    {
        let database = state.database()?;
        database
            .validate_rx_import(
                actor.id,
                request.patient_id,
                request.rx_type.as_deref().unwrap_or("endoral"),
                request.tooth_number,
            )
            .map_err(|error| error.to_string())?;
    }
    let dicom_metadata = if is_dicom_path(&request.source_path) {
        dicom_meta::extract_dicom_metadata(Path::new(&request.source_path))?
    } else {
        dicom_meta::DicomMetadata::empty()
    };
    let stored = files::store_patient_rx_file(request.patient_id, &request.source_path)?;
    state
        .database()?
        .register_rx_asset(
            actor.id,
            &NewRxAsset {
                patient_id: request.patient_id,
                relative_path: &stored.relative_path,
                mime_type: &stored.mime_type,
                sha256_hex: &stored.sha256_hex,
                size_bytes: stored.size_bytes,
                original_filename: &stored.original_filename,
                rx_type: request.rx_type.as_deref().unwrap_or("endoral"),
                tooth_number: request.tooth_number.or(dicom_metadata.tooth_number),
                dicom_metadata_json: &dicom_metadata.metadata_json,
                acquired_at: dicom_metadata.acquisition_datetime.as_deref(),
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mock_acquire_rx(
    state: State<'_, AppState>,
    request: MockAcquireRxRequest,
) -> Result<RxAsset, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    let adapter = MockRxAdapter;
    let source_path = adapter.acquire(request.patient_id, request.tooth_number)?;
    {
        let database = state.database()?;
        database
            .validate_rx_import(
                actor.id,
                request.patient_id,
                request.rx_type.as_deref().unwrap_or("endoral"),
                request.tooth_number,
            )
            .map_err(|error| error.to_string())?;
    }
    let stored =
        files::store_patient_rx_file(request.patient_id, source_path.to_string_lossy().as_ref())?;
    let empty_dicom_metadata = dicom_meta::DicomMetadata::empty();
    state
        .database()?
        .register_rx_asset(
            actor.id,
            &NewRxAsset {
                patient_id: request.patient_id,
                relative_path: &stored.relative_path,
                mime_type: &stored.mime_type,
                sha256_hex: &stored.sha256_hex,
                size_bytes: stored.size_bytes,
                original_filename: &stored.original_filename,
                rx_type: request.rx_type.as_deref().unwrap_or("endoral"),
                tooth_number: request.tooth_number,
                dicom_metadata_json: &empty_dicom_metadata.metadata_json,
                acquired_at: None,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_rx_assets(
    state: State<'_, AppState>,
    request: ListRxAssetsRequest,
) -> Result<Vec<RxAsset>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_rx_assets(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rx_asset_data_url(
    state: State<'_, AppState>,
    request: RxAssetDataUrlRequest,
) -> Result<RxAssetDataUrl, String> {
    let actor = require_session(&state, &request.session_token)?;
    let asset = state
        .database()?
        .rx_asset_for_access(actor.id, request.file_asset_id)
        .map_err(|error| error.to_string())?;
    let mime_type = asset
        .mime_type
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    if !mime_type.starts_with("image/") {
        return Err("clinical file preview is available only for image RX assets".to_owned());
    }
    let bytes = files::read_patient_file(&asset.relative_path)?;
    let data_url = format!(
        "data:{};base64,{}",
        mime_type,
        general_purpose::STANDARD.encode(bytes)
    );
    Ok(RxAssetDataUrl {
        file_asset_id: request.file_asset_id,
        mime_type,
        data_url,
    })
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
    let block_jobs = {
        let database = state.database()?;
        database
            .pending_google_calendar_block_sync_jobs(actor.id, request.limit.unwrap_or(10))
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

    for job in block_jobs {
        let payload = google_payload_for_agenda_block(&job.block);
        let result = google::upsert_calendar_event(
            &token.access_token,
            "primary",
            job.block.google_calendar_event_id.as_deref(),
            &payload,
        )
        .await;

        let database = state.database()?;
        match result {
            Ok(event_id) => {
                database
                    .complete_google_calendar_block_sync_job(
                        job.job_id,
                        job.block.id,
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

fn render_quote_pdf(
    settings: &StudioSettings,
    patient: &Patient,
    quote: &Quote,
) -> Result<Vec<u8>, String> {
    let lines = quote
        .lines
        .iter()
        .map(|line| PdfLine {
            description: line.description.clone(),
            quantity: line.quantity,
            unit_price_cents: line.unit_price_cents,
            total_cents: line.total_cents,
        })
        .collect();
    billing::render_financial_pdf(&FinancialPdf {
        document_title: "Preventivo".to_owned(),
        document_number: format!("Preventivo #{} - {}", quote.id, quote.status),
        studio: studio_pdf_party(settings),
        patient: patient_pdf_party(patient),
        lines,
        gross_total_cents: quote.gross_total_cents,
        discount_cents: quote.discount_cents,
        net_total_cents: quote.net_total_cents,
    })
}

fn render_invoice_pdf(
    settings: &StudioSettings,
    patient: &Patient,
    invoice: &Invoice,
) -> Result<Vec<u8>, String> {
    let lines = invoice
        .lines
        .iter()
        .map(|line| PdfLine {
            description: line.description.clone(),
            quantity: line.quantity,
            unit_price_cents: line.unit_price_cents,
            total_cents: line.total_cents,
        })
        .collect();
    billing::render_financial_pdf(&FinancialPdf {
        document_title: "Fattura".to_owned(),
        document_number: format!(
            "Fattura {}/{} - {}",
            invoice.invoice_number, invoice.invoice_year, invoice.issued_at
        ),
        studio: studio_pdf_party(settings),
        patient: patient_pdf_party(patient),
        lines,
        gross_total_cents: invoice.total_cents,
        discount_cents: 0,
        net_total_cents: invoice.total_cents,
    })
}

fn studio_pdf_party(settings: &StudioSettings) -> PdfParty {
    PdfParty {
        title: settings
            .clinic_name
            .clone()
            .unwrap_or_else(|| "Studio VeloDent".to_owned()),
        lines: vec![
            "Gestionale VeloDent Precision".to_owned(),
            settings
                .data_directory
                .clone()
                .unwrap_or_else(|| "Directory dati locale".to_owned()),
        ],
    }
}

fn patient_pdf_party(patient: &Patient) -> PdfParty {
    let mut lines = vec![
        format!("{} {}", patient.first_name, patient.last_name),
        format!("CF {}", patient.tax_code),
        format!("Nato/a il {}", patient.date_of_birth),
    ];
    if let Some(address) = &patient.address {
        lines.push(address.clone());
    }
    PdfParty {
        title: "Paziente".to_owned(),
        lines,
    }
}

fn is_dicom_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "dcm" | "dicom"))
        .unwrap_or(false)
}

fn wait_for_google_oauth_code(
    listener: TcpListener,
    expected_state: &str,
) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(180);
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("google login timed out".to_owned());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    };
    let mut buffer = [0_u8; 4096];
    let read = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "google callback request was empty".to_owned())?;
    let target = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "google callback request was not valid".to_owned())?;
    let query = target
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or_default();
    let parameters = parse_query_parameters(query);

    if let Some(error) = parameters.get("error") {
        write_oauth_response(&mut stream, false)?;
        return Err(format!("google login rejected: {error}"));
    }

    let state = parameters
        .get("state")
        .map(String::as_str)
        .unwrap_or_default();
    if state != expected_state {
        write_oauth_response(&mut stream, false)?;
        return Err("google login state mismatch".to_owned());
    }

    let code = parameters
        .get("code")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "google callback did not include an authorization code".to_owned())?
        .to_owned();
    write_oauth_response(&mut stream, true)?;
    Ok(code)
}

fn parse_query_parameters(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((percent_decode(key), percent_decode(value)))
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(decoded) = u8::from_str_radix(hex, 16) {
                output.push(decoded);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn write_oauth_response(stream: &mut impl Write, success: bool) -> Result<(), String> {
    let (status, title, body) = if success {
        (
            "200 OK",
            "VeloDent Google login completed",
            "You can close this browser tab and return to VeloDent.",
        )
    } else {
        (
            "400 Bad Request",
            "VeloDent Google login not completed",
            "Return to VeloDent and try Google login again.",
        )
    };
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head><body style=\"font-family:system-ui;background:#05070b;color:#eef6ff;padding:40px\"><h1>{title}</h1><p>{body}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}
