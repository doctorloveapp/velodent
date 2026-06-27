use crate::{
    agenda,
    auth::Role,
    backup::{self, BackupResult},
    billing::{self, FinancialPdf, PdfLine, PdfParty},
    clinical::{self, BridgeUnits},
    consents::{self, ConsentPdf},
    db::{
        AgendaBlock, Appointment, AppointmentInput, AuthSession, AuthorizedDevice,
        AuthorizedGoogleAccount, BootstrapStatus, ChairConfig, ClinicalRecord,
        ClinicalRecordFilters, ClinicalService, ConsentTemplate, CreateUserInput, DatabaseStatus,
        DeviceAuthorization, GeneratedDocument, GoogleCalendarAccount, GoogleCalendarSyncStatus,
        Invoice, LicenseStatus, NewAgendaBlock, NewClinicalRecord, NewPatient, NewRxAsset, Patient,
        PatientConsent, PatientTimelineEvent, Payment, Quote, RenderedConsent, RxAsset,
        StudioSettings, StudioSettingsUpdate, ToothStatus, User,
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
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};

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
    email: Option<String>,
    activation_key: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateEncryptedBackupRequest {
    session_token: String,
    admin_password: String,
    destination_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RestoreEncryptedBackupRequest {
    session_token: String,
    admin_password: String,
    backup_path: Option<String>,
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
pub struct ChangeAdminPasswordRequest {
    session_token: String,
    old_password: String,
    new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteUserRequest {
    session_token: String,
    user_id: i64,
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
pub struct ConsentTemplateUpdateRequest {
    session_token: String,
    template_id: i64,
    title: String,
    body: String,
    active: bool,
}

#[derive(Debug, Deserialize)]
pub struct RenderConsentRequest {
    session_token: String,
    patient_id: i64,
    template_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct SignConsentRequest {
    session_token: String,
    patient_id: i64,
    template_id: i64,
    checkbox_confirmations: Vec<bool>,
    signature_data_url: String,
}

#[derive(Debug, Deserialize)]
pub struct ConsentIdRequest {
    session_token: String,
    consent_id: i64,
}

#[derive(Debug, Serialize)]
pub struct PatientConsentDocumentDataUrl {
    consent_id: i64,
    mime_type: String,
    data_url: String,
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
pub struct RemoveGoogleAccountRequest {
    session_token: String,
    account_id: i64,
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
    sub_type: Option<String>,
    tooth_number: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PickRxImportRequest {
    session_token: String,
    patient_id: i64,
    rx_type: Option<String>,
    sub_type: Option<String>,
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

#[derive(Debug, Deserialize)]
pub struct DeleteRxAssetRequest {
    session_token: String,
    rx_asset_id: i64,
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
    sub_type: Option<String>,
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
pub struct DeleteAppointmentRequest {
    session_token: String,
    appointment_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateClinicalServicePriceRequest {
    session_token: String,
    service_id: i64,
    base_price_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct ClinicalServiceUpsertRequest {
    session_token: String,
    service_id: Option<i64>,
    code: String,
    name: String,
    category: Option<String>,
    base_price_cents: i64,
    sort_order: i64,
    active: bool,
}

#[derive(Debug, Deserialize)]
pub struct ClinicalServiceReorderRequest {
    session_token: String,
    service_id: i64,
    target_service_id: i64,
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
pub struct CreateDepositInvoiceRequest {
    session_token: String,
    quote_id: i64,
    amount_cents: i64,
    method: String,
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
    let _activation_email = request.email.as_deref().map(str::trim);
    state
        .database()?
        .activate_license(request.activation_key.trim())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_encrypted_backup(
    state: State<'_, AppState>,
    request: CreateEncryptedBackupRequest,
) -> Result<BackupResult, String> {
    let _actor = require_admin_session(&state, &request.session_token)?;
    let destination = match request.destination_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => rfd::FileDialog::new()
            .add_filter("VeloDent Backup", &["vdbk"])
            .set_file_name(default_backup_filename()?)
            .save_file()
            .ok_or_else(|| "backup annullato".to_owned())?,
    };
    let database = state.database()?;
    match backup::create_encrypted_backup(&database, &request.admin_password, &destination) {
        Ok(result) => {
            database
                .register_backup_run(&result.backup_path, "completed", Some(&result.sha256_hex), None)
                .map_err(|error| error.to_string())?;
            Ok(result)
        }
        Err(error) => {
            let _ = database.register_backup_run(
                &destination.to_string_lossy(),
                "failed",
                None,
                Some(&error),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn restore_encrypted_backup(
    state: State<'_, AppState>,
    request: RestoreEncryptedBackupRequest,
) -> Result<LicenseStatus, String> {
    let _actor = require_admin_session(&state, &request.session_token)?;
    let backup_path = match request.backup_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => rfd::FileDialog::new()
            .add_filter("VeloDent Backup", &["vdbk"])
            .pick_file()
            .ok_or_else(|| "restore annullato".to_owned())?,
    };
    let decrypted = backup::decrypt_backup_to_temp(&backup_path, &request.admin_password)?;
    let database = state.database()?;
    database
        .restore_database_from_file(&decrypted.database_path)
        .map_err(|error| error.to_string())?;
    backup::replace_patients_folder_from_backup(&decrypted.patients_path)?;
    let _ = fs::remove_dir_all(&decrypted.root);
    database
        .license_status()
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
pub fn delete_user(state: State<'_, AppState>, request: DeleteUserRequest) -> Result<User, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .delete_user(actor.id, request.user_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn change_admin_password(
    state: State<'_, AppState>,
    request: ChangeAdminPasswordRequest,
) -> Result<(), String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .change_admin_password(actor.id, &request.old_password, &request.new_password)
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
    pairing_code.public_url = Some(format!(
        "http://velodent.local:{}?mobile=1&pairing_pin={}",
        server::lan::PWA_FRONTEND_PORT,
        pairing_code.code
    ));
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
pub fn pick_studio_logo_path(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<Option<String>, String> {
    require_admin_session(&state, &request.session_token)?;
    Ok(rfd::FileDialog::new()
        .add_filter("Logo", &["png", "jpg", "jpeg", "webp", "svg"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
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
pub fn list_google_calendar_accounts(
    state: State<'_, AppState>,
    request: GoogleOAuthStatusRequest,
) -> Result<Vec<GoogleCalendarAccount>, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .list_google_calendar_accounts(actor.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remove_google_account(
    state: State<'_, AppState>,
    request: RemoveGoogleAccountRequest,
) -> Result<(), String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .remove_google_account(actor.id, request.account_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_google_calendar_account_link(
    app: AppHandle,
    state: State<'_, AppState>,
    request: GoogleAuthorizationUrlRequest,
) -> Result<GoogleCalendarAccount, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    let expected_state = request
        .state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("velodent-calendar")
        .to_owned();
    let authorization =
        google::authorization_url(&expected_state).map_err(|error| error.to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", 1421)).map_err(|error| {
        format!("unable to start Google Calendar listener on port 1421: {error}")
    })?;
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
    let token_json = serde_json::to_string(&token).map_err(|error| error.to_string())?;
    let account = state
        .database()?
        .store_google_calendar_account_token(
            actor.id,
            Some(&user_info.email),
            "primary",
            &token_json,
        )
        .map_err(|error| error.to_string())?;
    agenda::trigger_google_calendar_sync(&app, actor.id);
    Ok(account)
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
    app: AppHandle,
    state: State<'_, AppState>,
    request: CreateAgendaBlockRequest,
) -> Result<AgendaBlock, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    let block = state
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
        .map_err(|error| error.to_string())?;
    agenda::trigger_google_calendar_sync(&app, actor.id);
    Ok(block)
}

#[tauri::command]
pub fn delete_agenda_block(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DeleteAgendaBlockRequest,
) -> Result<AgendaBlock, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    let block = state
        .database()?
        .delete_agenda_block(actor.id, request.block_id)
        .map_err(|error| error.to_string())?;
    agenda::trigger_google_calendar_sync(&app, actor.id);
    Ok(block)
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
    app: AppHandle,
    state: State<'_, AppState>,
    request: CreateAppointmentRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    let appointment = state
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
        .map_err(|error| error.to_string())?;
    agenda::trigger_google_calendar_sync(&app, actor.id);
    Ok(appointment)
}

#[tauri::command]
pub fn move_appointment(
    app: AppHandle,
    state: State<'_, AppState>,
    request: MoveAppointmentRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    let appointment = state
        .database()?
        .move_appointment(
            actor.id,
            request.appointment_id,
            request.starts_at.trim(),
            request.ends_at.trim(),
            request.chair_number,
        )
        .map_err(|error| error.to_string())?;
    agenda::trigger_google_calendar_sync(&app, actor.id);
    Ok(appointment)
}

#[tauri::command]
pub fn update_appointment_status(
    app: AppHandle,
    state: State<'_, AppState>,
    request: UpdateAppointmentStatusRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    let appointment = state
        .database()?
        .update_appointment_status(actor.id, request.appointment_id, request.status.trim())
        .map_err(|error| error.to_string())?;
    agenda::trigger_google_calendar_sync(&app, actor.id);
    Ok(appointment)
}

#[tauri::command]
pub async fn delete_appointment(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DeleteAppointmentRequest,
) -> Result<Appointment, String> {
    let actor = require_session(&state, &request.session_token)?;
    let appointment = state
        .database()?
        .appointment_for_actor(actor.id, request.appointment_id)
        .map_err(|error| error.to_string())?;
    agenda::delete_google_calendar_events_for_appointment(&app, actor.id, &appointment).await?;
    state
        .database()?
        .delete_appointment(actor.id, request.appointment_id)
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
pub fn list_consent_templates(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<Vec<ConsentTemplate>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_consent_templates(actor.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_consent_template(
    state: State<'_, AppState>,
    request: ConsentTemplateUpdateRequest,
) -> Result<ConsentTemplate, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .update_consent_template(
            actor.id,
            request.template_id,
            request.title.trim(),
            request.body.trim(),
            request.active,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn render_consent_template(
    state: State<'_, AppState>,
    request: RenderConsentRequest,
) -> Result<RenderedConsent, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .render_consent_template(actor.id, request.patient_id, request.template_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn sign_patient_consent(
    state: State<'_, AppState>,
    request: SignConsentRequest,
) -> Result<PatientConsent, String> {
    let actor = require_session(&state, &request.session_token)?;
    sign_consent_for_actor(
        state.inner(),
        actor.id,
        None,
        request.patient_id,
        request.template_id,
        request.checkbox_confirmations,
        request.signature_data_url.trim(),
    )
}

#[tauri::command]
pub fn list_patient_consents(
    state: State<'_, AppState>,
    request: PatientIdRequest,
) -> Result<Vec<PatientConsent>, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .list_patient_consents(actor.id, request.patient_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_patient_consent_document(
    state: State<'_, AppState>,
    request: ConsentIdRequest,
) -> Result<String, String> {
    let actor = require_session(&state, &request.session_token)?;
    let consent = state
        .database()?
        .patient_consent_for_access(actor.id, request.consent_id)
        .map_err(|error| error.to_string())?;
    let relative_path = consent
        .relative_path
        .as_deref()
        .ok_or_else(|| "consent document file is missing".to_owned())?;
    let filename = relative_path
        .rsplit('/')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("consenso-velodent.pdf");
    let bytes = files::read_patient_file(relative_path)?;
    let normalized_bytes =
        consents::normalize_consent_pdf_bytes(&bytes).unwrap_or_else(|_| bytes.clone());
    let opened = files::export_document_bytes_to_downloads_and_open(&normalized_bytes, filename)?;
    Ok(opened.to_string_lossy().to_string())
}

#[tauri::command]
pub fn patient_consent_document_data_url(
    state: State<'_, AppState>,
    request: ConsentIdRequest,
) -> Result<PatientConsentDocumentDataUrl, String> {
    let actor = require_session(&state, &request.session_token)?;
    consent_document_data_url_for_actor(state.inner(), actor.id, request.consent_id)
}

#[tauri::command]
pub fn delete_patient_consent_document(
    state: State<'_, AppState>,
    request: ConsentIdRequest,
) -> Result<PatientConsent, String> {
    let actor = require_session(&state, &request.session_token)?;
    let consent = state
        .database()?
        .delete_patient_consent_document(actor.id, request.consent_id)
        .map_err(|error| error.to_string())?;
    if let Some(relative_path) = consent.relative_path.as_deref() {
        files::delete_patient_file(relative_path)?;
    }
    Ok(consent)
}

pub(crate) fn consent_document_data_url_for_actor(
    state: &AppState,
    actor_user_id: i64,
    consent_id: i64,
) -> Result<PatientConsentDocumentDataUrl, String> {
    let consent = state
        .database()?
        .patient_consent_for_access(actor_user_id, consent_id)
        .map_err(|error| error.to_string())?;
    let relative_path = consent
        .relative_path
        .as_deref()
        .ok_or_else(|| "consent document file is missing".to_owned())?;
    let bytes = files::read_patient_file(relative_path)?;
    let bytes = consents::normalize_consent_pdf_bytes(&bytes).unwrap_or(bytes);
    let mime_type = "application/pdf".to_owned();
    Ok(PatientConsentDocumentDataUrl {
        consent_id: consent.id,
        data_url: format!(
            "data:{};base64,{}",
            mime_type,
            general_purpose::STANDARD.encode(bytes)
        ),
        mime_type,
    })
}

pub(crate) fn sign_consent_for_actor(
    state: &AppState,
    actor_user_id: i64,
    signed_device_id: Option<i64>,
    patient_id: i64,
    template_id: i64,
    checkbox_confirmations: Vec<bool>,
    signature_data_url: &str,
) -> Result<PatientConsent, String> {
    let database = state.database()?;
    let rendered = database
        .render_consent_template(actor_user_id, patient_id, template_id)
        .map_err(|error| error.to_string())?;
    let required_count = usize::try_from(rendered.required_checkbox_count)
        .map_err(|_| "invalid required checkbox count".to_owned())?;
    if checkbox_confirmations.len() < required_count
        || checkbox_confirmations
            .iter()
            .take(required_count)
            .any(|checked| !checked)
    {
        return Err("required consent checkboxes are missing".to_owned());
    }
    let signature_png = decode_signature_png(signature_data_url)?;
    let signature_sha256_hex = sha256_hex(&signature_png);
    let signed_at = current_short_date_string()?;
    let patient = database
        .get_patient(patient_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "patient not found".to_owned())?;
    let patient_name = format!("{} {}", patient.first_name, patient.last_name);
    let pdf_bytes = consents::render_consent_pdf(&ConsentPdf {
        title: &rendered.template.title,
        patient_name: patient_name.trim(),
        signed_at: &signed_at,
        body: &rendered.rendered_body,
        signature_png: &signature_png,
    })?;
    let stored = files::store_patient_document_bytes(
        patient_id,
        "consent",
        &format!("consenso-{}-{}", rendered.template.template_key, patient_id),
        &pdf_bytes,
    )?;
    database
        .register_signed_consent(
            actor_user_id,
            signed_device_id,
            patient_id,
            &rendered.template,
            &rendered.rendered_body,
            &serde_json::to_string(&checkbox_confirmations).map_err(|error| error.to_string())?,
            &signature_sha256_hex,
            &stored.relative_path,
            &stored.mime_type,
            &stored.sha256_hex,
            stored.size_bytes,
        )
        .map_err(|error| error.to_string())
}

fn decode_signature_png(signature_data_url: &str) -> Result<Vec<u8>, String> {
    let payload = signature_data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "signature must be a PNG data URL".to_owned())?;
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|error| error.to_string())?;
    if bytes.len() < 16 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("signature PNG is invalid".to_owned());
    }
    Ok(bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn current_short_date_string() -> Result<String, String> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let days = i64::try_from(seconds / 86_400).map_err(|error| error.to_string())?;
    let (year, month, day) = civil_date_from_unix_days(days);
    Ok(format!("{day:02}/{month:02}/{:02}", year.rem_euclid(100)))
}

fn civil_date_from_unix_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(month <= 2);
    (year as i32, month as u32, day as u32)
}

fn default_backup_filename() -> Result<String, String> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    Ok(format!("velodent-backup-{seconds}.vdbk"))
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
pub fn list_clinical_services_catalog(
    state: State<'_, AppState>,
    request: ActorRequest,
) -> Result<Vec<ClinicalService>, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .list_clinical_services_catalog(actor.id)
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
pub fn upsert_clinical_service(
    state: State<'_, AppState>,
    request: ClinicalServiceUpsertRequest,
) -> Result<ClinicalService, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    let database = state.database()?;
    if let Some(service_id) = request.service_id {
        database.update_clinical_service(
            actor.id,
            service_id,
            request.code.trim(),
            request.name.trim(),
            request.category.as_deref(),
            request.base_price_cents,
            request.sort_order,
            request.active,
        )
    } else {
        database.create_clinical_service(
            actor.id,
            request.code.trim(),
            request.name.trim(),
            request.category.as_deref(),
            request.base_price_cents,
            request.sort_order,
        )
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reorder_clinical_service(
    state: State<'_, AppState>,
    request: ClinicalServiceReorderRequest,
) -> Result<Vec<ClinicalService>, String> {
    let actor = require_admin_session(&state, &request.session_token)?;
    state
        .database()?
        .reorder_clinical_service(actor.id, request.service_id, request.target_service_id)
        .map(|(service, target)| vec![service, target])
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
pub fn create_deposit_invoice(
    state: State<'_, AppState>,
    request: CreateDepositInvoiceRequest,
) -> Result<Invoice, String> {
    let actor = require_session(&state, &request.session_token)?;
    state
        .database()?
        .create_deposit_invoice(
            actor.id,
            request.quote_id,
            request.amount_cents,
            request.method.trim(),
        )
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
    let document = database
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
        .map_err(|error| error.to_string())?;
    files::export_patient_file_to_downloads_and_open(
        &stored.relative_path,
        &stored.original_filename,
    )?;
    Ok(document)
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
    let document = database
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
        .map_err(|error| error.to_string())?;
    files::export_patient_file_to_downloads_and_open(
        &stored.relative_path,
        &stored.original_filename,
    )?;
    Ok(document)
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
    import_rx_path(
        &state,
        actor.id,
        request.patient_id,
        &request.source_path,
        request.rx_type.as_deref(),
        request.sub_type.as_deref(),
        request.tooth_number,
    )
}

#[tauri::command]
pub fn pick_rx_file_and_import(
    state: State<'_, AppState>,
    request: PickRxImportRequest,
) -> Result<RxAsset, String> {
    let actor = require_session(&state, &request.session_token)?;
    let Some(path) = rfd::FileDialog::new()
        .add_filter("RX/DICOM", &["jpg", "jpeg", "png", "dcm", "dicom"])
        .pick_file()
    else {
        return Err("rx file selection cancelled".to_owned());
    };
    import_rx_path(
        &state,
        actor.id,
        request.patient_id,
        path.to_string_lossy().as_ref(),
        request.rx_type.as_deref(),
        request.sub_type.as_deref(),
        request.tooth_number,
    )
}

#[tauri::command]
pub fn pick_rx_folder_and_import(
    state: State<'_, AppState>,
    request: PickRxImportRequest,
) -> Result<Vec<RxAsset>, String> {
    let actor = require_session(&state, &request.session_token)?;
    let Some(folder) = rfd::FileDialog::new().pick_folder() else {
        return Err("rx folder selection cancelled".to_owned());
    };
    let candidates = collect_supported_rx_files(&folder, 500)?;
    if candidates.is_empty() {
        return Err("no supported RX or DICOM files found".to_owned());
    }
    let mut imported = Vec::new();
    for path in candidates {
        imported.push(import_rx_path(
            &state,
            actor.id,
            request.patient_id,
            path.to_string_lossy().as_ref(),
            request.rx_type.as_deref(),
            request.sub_type.as_deref(),
            request.tooth_number,
        )?);
    }
    Ok(imported)
}

fn import_rx_path(
    state: &AppState,
    actor_id: i64,
    patient_id: i64,
    source_path: &str,
    rx_type: Option<&str>,
    sub_type: Option<&str>,
    tooth_number: Option<i64>,
) -> Result<RxAsset, String> {
    let source = PathBuf::from(source_path);
    let inferred_rx_type = infer_rx_type(&source, rx_type);
    let inferred_sub_type = infer_rx_sub_type(&source, sub_type, &inferred_rx_type);
    let mut dicom_metadata = if is_dicom_file_path(&source) {
        dicom_meta::extract_dicom_metadata(&source)?
    } else {
        dicom_meta::DicomMetadata::empty()
    };
    let resolved_tooth = tooth_number.or(dicom_metadata.tooth_number);

    {
        let database = state.database()?;
        database
            .validate_rx_import(actor_id, patient_id, &inferred_rx_type, resolved_tooth)
            .map_err(|error| error.to_string())?;
    }

    let stored = files::store_patient_rx_file(patient_id, source_path)?;
    if dicom_metadata.tooth_number.is_none() {
        dicom_metadata.tooth_number = resolved_tooth;
    }

    state
        .database()?
        .register_rx_asset(
            actor_id,
            &NewRxAsset {
                patient_id,
                relative_path: &stored.relative_path,
                mime_type: &stored.mime_type,
                sha256_hex: &stored.sha256_hex,
                size_bytes: stored.size_bytes,
                original_filename: &stored.original_filename,
                rx_type: &inferred_rx_type,
                sub_type: &inferred_sub_type,
                tooth_number: resolved_tooth,
                dicom_metadata_json: &dicom_metadata.metadata_json,
                acquired_at: dicom_metadata.acquisition_datetime.as_deref(),
            },
        )
        .map_err(|error| error.to_string())
}

fn collect_supported_rx_files(root: &Path, limit: usize) -> Result<Vec<PathBuf>, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(folder) = stack.pop() {
        let entries = fs::read_dir(&folder).map_err(|error| error.to_string())?;
        for entry in entries {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if is_supported_rx_path(&path) {
                files.push(path);
                if files.len() >= limit {
                    files.sort();
                    return Ok(files);
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

fn is_supported_rx_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "dcm" | "dicom"
            )
        })
        .unwrap_or(false)
}

fn is_dicom_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "dcm" | "dicom"))
        .unwrap_or(false)
}

fn infer_rx_type(path: &Path, requested: Option<&str>) -> String {
    if let Some(rx_type) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return rx_type.to_owned();
    }

    let name = path.to_string_lossy().to_ascii_lowercase();
    if name.contains("cbct") || name.contains("cone") || name.contains("tac") || name.contains("ct")
    {
        return "cbct".to_owned();
    }
    if name.contains("pano")
        || name.contains("opg")
        || name.contains("ortop")
        || name.contains("panoram")
    {
        return "panoramic".to_owned();
    }
    if name.contains("foto") || name.contains("photo") || name.contains("camera") {
        return "photo".to_owned();
    }
    "endoral".to_owned()
}

fn infer_rx_sub_type(path: &Path, requested: Option<&str>, rx_type: &str) -> String {
    if let Some(sub_type) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return sub_type.to_ascii_uppercase();
    }

    let name = path.to_string_lossy().to_ascii_lowercase();
    if rx_type == "photo"
        || name.contains("foto")
        || name.contains("photo")
        || name.contains("camera")
    {
        return "PHOTO".to_owned();
    }
    if rx_type == "endoral"
        || name.contains("endor")
        || name.contains("periap")
        || name.contains("bite")
    {
        return "ENDORALE".to_owned();
    }
    "ORTOPANTOMOGRAFIA".to_owned()
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
                sub_type: request.sub_type.as_deref().unwrap_or("ENDORALE"),
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
pub fn delete_rx_asset(
    state: State<'_, AppState>,
    request: DeleteRxAssetRequest,
) -> Result<RxAsset, String> {
    let actor = require_session(&state, &request.session_token)?;
    let asset = state
        .database()?
        .delete_rx_asset(actor.id, request.rx_asset_id)
        .map_err(|error| error.to_string())?;
    files::delete_patient_file(&asset.relative_path)?;
    Ok(asset)
}

#[tauri::command]
pub async fn process_google_calendar_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ProcessGoogleCalendarSyncRequest,
) -> Result<GoogleCalendarSyncRunResult, String> {
    let actor = require_session(&state, &request.session_token)?;
    let _ = request.limit;
    let (processed, failed) = agenda::process_google_calendar_sync(&app, actor.id).await?;
    Ok(GoogleCalendarSyncRunResult { processed, failed })
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
        logo_bytes: studio_logo_bytes(settings),
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
        logo_bytes: studio_logo_bytes(settings),
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

fn studio_logo_bytes(settings: &StudioSettings) -> Option<Vec<u8>> {
    let path = settings.logo_relative_path.as_deref()?.trim();
    if path.is_empty() {
        return None;
    }
    fs::read(Path::new(path)).ok()
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
