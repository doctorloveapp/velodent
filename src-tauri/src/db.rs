use crate::{
    auth::{self, Role},
    integrations::google,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const CURRENT_SCHEMA_VERSION: i64 = 5;
const DEFAULT_DEV_KEY: &str = "velodent-development-only-change-me";

#[derive(Debug)]
pub enum DbError {
    Io(String),
    Sql(String),
    InvalidEncryptionKey,
    MissingEncryptionKey,
    Forbidden,
    InvalidRole(String),
    InvalidTaxCode,
    InvalidToothNumber,
    InvalidClinicalStatus(String),
    InvalidToothState(String),
    InvalidAppointmentStatus(String),
    InvalidAppointmentTimeRange,
    AppointmentConflict,
    GoogleCalendarNotConnected,
    InvalidCredentials,
    BootstrapAlreadyCompleted,
    NotFound,
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) => write!(f, "filesystem error: {message}"),
            Self::Sql(message) => write!(f, "database error: {message}"),
            Self::InvalidEncryptionKey => write!(f, "database encryption key is empty"),
            Self::MissingEncryptionKey => write!(
                f,
                "VELODENT_DB_KEY is required unless VELODENT_ALLOW_INSECURE_DEV_KEY=true"
            ),
            Self::Forbidden => write!(f, "operation requires admin privileges"),
            Self::InvalidRole(role) => write!(f, "invalid role: {role}"),
            Self::InvalidTaxCode => write!(f, "invalid italian tax code"),
            Self::InvalidToothNumber => write!(f, "invalid ISO/FDI tooth number"),
            Self::InvalidClinicalStatus(status) => write!(f, "invalid clinical status: {status}"),
            Self::InvalidToothState(state) => write!(f, "invalid tooth state: {state}"),
            Self::InvalidAppointmentStatus(status) => {
                write!(f, "invalid appointment status: {status}")
            }
            Self::InvalidAppointmentTimeRange => write!(f, "invalid appointment time range"),
            Self::AppointmentConflict => write!(f, "appointment conflicts on the same chair"),
            Self::GoogleCalendarNotConnected => write!(f, "google calendar is not connected"),
            Self::InvalidCredentials => write!(f, "invalid credentials"),
            Self::BootstrapAlreadyCompleted => write!(f, "first admin already exists"),
            Self::NotFound => write!(f, "record not found"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sql(value.to_string())
    }
}

impl From<std::io::Error> for DbError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, Clone)]
pub struct EncryptionKey {
    value: String,
    source: KeySource,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    Environment,
    DevelopmentFallback,
}

impl EncryptionKey {
    pub fn from_environment() -> DbResult<Self> {
        match env::var("VELODENT_DB_KEY") {
            Ok(value) if !value.trim().is_empty() => Ok(Self {
                value,
                source: KeySource::Environment,
            }),
            Ok(_) => Err(DbError::InvalidEncryptionKey),
            Err(_) if allow_insecure_development_key() => Ok(Self {
                value: DEFAULT_DEV_KEY.to_owned(),
                source: KeySource::DevelopmentFallback,
            }),
            Err(_) => Err(DbError::MissingEncryptionKey),
        }
    }

    fn value(&self) -> &str {
        &self.value
    }

    fn source(&self) -> KeySource {
        self.source
    }

    fn uses_development_fallback(&self) -> bool {
        matches!(self.source, KeySource::DevelopmentFallback)
    }
}

#[cfg(test)]
impl EncryptionKey {
    fn for_tests() -> Self {
        Self {
            value: "velodent-test-key".to_owned(),
            source: KeySource::Environment,
        }
    }
}

fn allow_insecure_development_key() -> bool {
    env::var("VELODENT_ALLOW_INSECURE_DEV_KEY")
        .map(|value| value == "true")
        .unwrap_or(false)
}

pub struct Database {
    conn: Connection,
    path: PathBuf,
    key_source: KeySource,
    uses_development_key: bool,
}

#[derive(Debug, Serialize)]
pub struct DatabaseStatus {
    pub open: bool,
    pub encrypted: bool,
    pub schema_version: i64,
    pub sqlcipher_version: String,
    pub foreign_keys_enabled: bool,
    pub database_path: String,
    pub key_source: KeySource,
    pub uses_development_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Patient {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub tax_code: String,
    pub date_of_birth: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub privacy_consent_signed: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NewPatient<'a> {
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub tax_code: &'a str,
    pub date_of_birth: &'a str,
    pub phone: Option<&'a str>,
    pub email: Option<&'a str>,
    pub address: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PatientTimelineEvent {
    pub action: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub google_email: Option<String>,
    pub role: Role,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthSession {
    pub user: User,
    pub session_token: String,
}

#[derive(Debug, Clone)]
pub struct CreateUserInput<'a> {
    pub username: &'a str,
    pub password: Option<&'a str>,
    pub google_email: Option<&'a str>,
    pub role: Role,
}

#[derive(Debug, Clone, Serialize)]
pub struct BootstrapStatus {
    pub needs_first_admin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthorizedGoogleAccount {
    pub id: i64,
    pub email: String,
    pub role: Role,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthorizedDevice {
    pub id: i64,
    pub user_id: Option<i64>,
    pub label: String,
    pub allowed_lan_cidr: Option<String>,
    pub revoked_at: Option<String>,
    pub expires_at: Option<String>,
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceAuthorization {
    pub device: AuthorizedDevice,
    pub token_once: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StudioSettings {
    pub clinic_name: Option<String>,
    pub logo_relative_path: Option<String>,
    pub chair_count: i64,
    pub data_directory: Option<String>,
    pub holiday_periods_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct StudioSettingsUpdate<'a> {
    pub clinic_name: Option<&'a str>,
    pub logo_relative_path: Option<&'a str>,
    pub chair_count: i64,
    pub data_directory: Option<&'a str>,
    pub holiday_periods_json: &'a str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChairConfig {
    pub chair_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Appointment {
    pub id: i64,
    pub patient_id: Option<i64>,
    pub patient_name: Option<String>,
    pub chair_number: i64,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub status: String,
    pub color_tag: Option<String>,
    pub google_calendar_event_id: Option<String>,
    pub last_google_sync_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct AppointmentInput<'a> {
    pub patient_id: Option<i64>,
    pub chair_number: i64,
    pub title: &'a str,
    pub starts_at: &'a str,
    pub ends_at: &'a str,
    pub status: &'a str,
    pub color_tag: Option<&'a str>,
    pub notes: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleCalendarSyncStatus {
    pub configured: bool,
    pub connected: bool,
    pub queued_jobs: i64,
    pub failed_jobs: i64,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleCalendarSyncJob {
    pub job_id: i64,
    pub appointment: Appointment,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClinicalService {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub category: Option<String>,
    pub base_price_cents: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToothStatus {
    pub patient_id: i64,
    pub tooth_number: i64,
    pub state: String,
    pub updated_by_user_id: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NewClinicalRecord<'a> {
    pub patient_id: i64,
    pub service_id: Option<i64>,
    pub tooth_number: Option<i64>,
    pub tooth_surface: Option<&'a str>,
    pub pathology_description: Option<&'a str>,
    pub status: &'a str,
    pub ready_for_quote: bool,
    pub notes: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct ClinicalRecordFilters<'a> {
    pub date_from: Option<&'a str>,
    pub date_to: Option<&'a str>,
    pub tooth_number: Option<i64>,
    pub operator_user_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClinicalRecord {
    pub id: i64,
    pub patient_id: i64,
    pub service_id: Option<i64>,
    pub service_code: Option<String>,
    pub service_name: Option<String>,
    pub tooth_number: Option<i64>,
    pub tooth_surface: Option<String>,
    pub pathology_description: Option<String>,
    pub status: String,
    pub ready_for_quote: bool,
    pub notes: Option<String>,
    pub operator_user_id: Option<i64>,
    pub operator_username: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    pub fn open_default() -> DbResult<Self> {
        let path = default_database_path();
        let key = EncryptionKey::from_environment()?;
        Self::open(path, key)
    }

    pub fn open(path: PathBuf, key: EncryptionKey) -> DbResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;
        configure_encryption(&conn, key.value())?;
        configure_connection(&conn)?;
        run_migrations(&conn)?;

        Ok(Self {
            conn,
            path,
            key_source: key.source(),
            uses_development_key: key.uses_development_fallback(),
        })
    }

    pub fn status(&self) -> DbResult<DatabaseStatus> {
        let schema_version: i64 = self
            .conn
            .query_row(
                "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);

        let sqlcipher_version: String = self
            .conn
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .unwrap_or_else(|_| "unavailable".to_owned());

        let foreign_keys_enabled: i64 = self
            .conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;

        Ok(DatabaseStatus {
            open: true,
            encrypted: sqlcipher_version != "unavailable" && !sqlcipher_version.trim().is_empty(),
            schema_version,
            sqlcipher_version,
            foreign_keys_enabled: foreign_keys_enabled == 1,
            database_path: self.path.to_string_lossy().into_owned(),
            key_source: self.key_source,
            uses_development_key: self.uses_development_key,
        })
    }

    pub fn bootstrap_status(&self) -> DbResult<BootstrapStatus> {
        Ok(BootstrapStatus {
            needs_first_admin: !self.has_admin_user()?,
        })
    }

    pub fn create_first_admin(
        &self,
        username: &str,
        password: &str,
        google_email: Option<&str>,
    ) -> DbResult<User> {
        if self.has_admin_user()? {
            self.insert_audit(
                None,
                None,
                "auth.first_admin_rejected",
                Some("users"),
                None,
                "{}",
            )?;
            return Err(DbError::BootstrapAlreadyCompleted);
        }

        let password_hash = auth::hash_password(password).map_err(DbError::Sql)?;
        self.conn.execute(
            r#"
            INSERT INTO users (username, password_hash, google_email, role)
            VALUES (?1, ?2, ?3, 'admin')
            "#,
            params![username, password_hash, google_email],
        )?;

        let user_id = self.conn.last_insert_rowid();
        self.insert_audit(
            Some(user_id),
            None,
            "auth.first_admin_created",
            Some("users"),
            Some(user_id),
            "{}",
        )?;

        if let Some(email) = normalize_optional(google_email) {
            self.conn.execute(
                r#"
                INSERT INTO authorized_google_accounts (email, role, created_by_user_id)
                VALUES (?1, 'admin', ?2)
                ON CONFLICT(email) DO UPDATE SET
                    role = 'admin',
                    active = 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                "#,
                params![email, user_id],
            )?;
        }

        self.get_user(user_id)?
            .ok_or_else(|| DbError::Sql("created admin was not found".to_owned()))
    }

    pub fn login(&self, username: &str, password: &str) -> DbResult<User> {
        let row = self
            .conn
            .query_row(
                r#"
                SELECT
                    id,
                    username,
                    password_hash,
                    google_email,
                    role,
                    active,
                    created_at,
                    updated_at
                FROM users
                WHERE username = ?1
                "#,
                [username],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?;

        let Some((id, username, password_hash, google_email, role, active, created_at, updated_at)) =
            row
        else {
            self.insert_audit(None, None, "auth.login_failed", Some("users"), None, "{}")?;
            return Err(DbError::InvalidCredentials);
        };

        let valid = active == 1
            && password_hash
                .as_deref()
                .map(|hash| auth::verify_password(password, hash))
                .unwrap_or(false);

        if !valid {
            self.insert_audit(
                Some(id),
                None,
                "auth.login_failed",
                Some("users"),
                Some(id),
                "{}",
            )?;
            return Err(DbError::InvalidCredentials);
        }

        self.insert_audit(
            Some(id),
            None,
            "auth.login_success",
            Some("users"),
            Some(id),
            "{}",
        )?;

        Ok(User {
            id,
            username,
            google_email,
            role: parse_role(&role)?,
            active: true,
            created_at,
            updated_at,
        })
    }

    pub fn create_session(&self, user_id: i64) -> DbResult<AuthSession> {
        let user = self.get_user(user_id)?.ok_or(DbError::Forbidden)?;
        if !user.active {
            return Err(DbError::Forbidden);
        }

        let generated = auth::generate_device_token();
        self.conn.execute(
            r#"
            INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
            VALUES (?1, ?2, datetime('now', '+12 hours'))
            "#,
            params![user_id, generated.hash],
        )?;

        self.insert_audit(
            Some(user_id),
            None,
            "auth.session_created",
            Some("user_sessions"),
            Some(self.conn.last_insert_rowid()),
            "{}",
        )?;

        Ok(AuthSession {
            user,
            session_token: generated.plaintext,
        })
    }

    pub fn user_for_session(&self, session_token: &str) -> DbResult<User> {
        if session_token.trim().is_empty() {
            return Err(DbError::Forbidden);
        }

        let token_hash = auth::hash_device_token(session_token.trim());
        let user = self
            .conn
            .query_row(
                r#"
                SELECT
                    u.id,
                    u.username,
                    u.google_email,
                    u.role,
                    u.active,
                    u.created_at,
                    u.updated_at
                FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE
                    s.session_token_hash = ?1
                    AND s.revoked_at IS NULL
                    AND datetime(s.expires_at) > datetime('now')
                    AND u.active = 1
                "#,
                [token_hash],
                user_from_row,
            )
            .optional()?
            .ok_or(DbError::Forbidden)?;

        Ok(user)
    }

    pub fn create_user(&self, actor_user_id: i64, input: &CreateUserInput<'_>) -> DbResult<User> {
        self.assert_admin(actor_user_id)?;
        let password_hash = input
            .password
            .map(auth::hash_password)
            .transpose()
            .map_err(DbError::Sql)?;

        self.conn.execute(
            r#"
            INSERT INTO users (username, password_hash, google_email, role)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![
                input.username,
                password_hash,
                input.google_email,
                input.role.as_db_value()
            ],
        )?;

        let user_id = self.conn.last_insert_rowid();
        self.insert_audit(
            Some(actor_user_id),
            None,
            "settings.user_created",
            Some("users"),
            Some(user_id),
            "{}",
        )?;

        self.get_user(user_id)?
            .ok_or_else(|| DbError::Sql("created user was not found".to_owned()))
    }

    pub fn list_users(&self) -> DbResult<Vec<User>> {
        let mut statement = self.conn.prepare(
            r#"
            SELECT id, username, google_email, role, active, created_at, updated_at
            FROM users
            ORDER BY username ASC
            "#,
        )?;

        let users = statement
            .query_map([], user_from_row)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(users)
    }

    pub fn add_authorized_google_account(
        &self,
        actor_user_id: i64,
        email: &str,
        role: Role,
    ) -> DbResult<AuthorizedGoogleAccount> {
        self.assert_admin(actor_user_id)?;
        self.conn.execute(
            r#"
            INSERT INTO authorized_google_accounts (email, role, created_by_user_id)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(email) DO UPDATE SET
                role = excluded.role,
                active = 1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            params![email, role.as_db_value(), actor_user_id],
        )?;

        let account = self
            .get_authorized_google_account(email)?
            .ok_or_else(|| DbError::Sql("authorized google account not found".to_owned()))?;

        self.insert_audit(
            Some(actor_user_id),
            None,
            "settings.google_account_authorized",
            Some("authorized_google_accounts"),
            Some(account.id),
            "{}",
        )?;

        Ok(account)
    }

    pub fn list_authorized_google_accounts(&self) -> DbResult<Vec<AuthorizedGoogleAccount>> {
        let mut statement = self.conn.prepare(
            r#"
            SELECT id, email, role, active, created_at, updated_at
            FROM authorized_google_accounts
            ORDER BY email ASC
            "#,
        )?;

        let accounts = statement
            .query_map([], google_account_from_row)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(accounts)
    }

    pub fn authorize_device(
        &self,
        actor_user_id: i64,
        user_id: Option<i64>,
        label: &str,
        allowed_lan_cidr: Option<&str>,
        expires_at: Option<&str>,
    ) -> DbResult<DeviceAuthorization> {
        self.assert_admin(actor_user_id)?;
        let generated = auth::generate_device_token();

        self.conn.execute(
            r#"
            INSERT INTO authorized_devices (
                user_id,
                label,
                device_token_hash,
                allowed_lan_cidr,
                expires_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![user_id, label, generated.hash, allowed_lan_cidr, expires_at],
        )?;

        let device_id = self.conn.last_insert_rowid();
        self.insert_audit(
            Some(actor_user_id),
            Some(device_id),
            "settings.device_authorized",
            Some("authorized_devices"),
            Some(device_id),
            "{}",
        )?;

        let device = self
            .get_device(device_id)?
            .ok_or_else(|| DbError::Sql("authorized device not found".to_owned()))?;

        Ok(DeviceAuthorization {
            device,
            token_once: generated.plaintext,
        })
    }

    pub fn revoke_device(&self, actor_user_id: i64, device_id: i64) -> DbResult<AuthorizedDevice> {
        self.assert_admin(actor_user_id)?;
        self.conn.execute(
            r#"
            UPDATE authorized_devices
            SET
                revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
            [device_id],
        )?;

        self.insert_audit(
            Some(actor_user_id),
            Some(device_id),
            "settings.device_revoked",
            Some("authorized_devices"),
            Some(device_id),
            "{}",
        )?;

        self.get_device(device_id)?
            .ok_or_else(|| DbError::Sql("device not found".to_owned()))
    }

    pub fn list_devices(&self) -> DbResult<Vec<AuthorizedDevice>> {
        let mut statement = self.conn.prepare(
            r#"
            SELECT
                id,
                user_id,
                label,
                allowed_lan_cidr,
                revoked_at,
                expires_at,
                last_seen_at,
                created_at,
                updated_at
            FROM authorized_devices
            ORDER BY created_at DESC
            "#,
        )?;

        let devices = statement
            .query_map([], device_from_row)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(devices)
    }

    pub fn studio_settings(&self) -> DbResult<StudioSettings> {
        self.conn
            .query_row(
                r#"
                SELECT
                    clinic_name,
                    logo_relative_path,
                    chair_count,
                    data_directory,
                    holiday_periods_json,
                    created_at,
                    updated_at
                FROM studio_settings
                WHERE id = 1
                "#,
                [],
                studio_settings_from_row,
            )
            .map_err(DbError::from)
    }

    pub fn update_studio_settings(
        &self,
        actor_user_id: i64,
        input: &StudioSettingsUpdate<'_>,
    ) -> DbResult<StudioSettings> {
        self.assert_admin(actor_user_id)?;
        self.conn.execute(
            r#"
            UPDATE studio_settings
            SET
                clinic_name = ?1,
                logo_relative_path = ?2,
                chair_count = ?3,
                data_directory = ?4,
                holiday_periods_json = ?5,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = 1
            "#,
            params![
                input.clinic_name,
                input.logo_relative_path,
                input.chair_count,
                input.data_directory,
                input.holiday_periods_json,
            ],
        )?;

        self.insert_audit(
            Some(actor_user_id),
            None,
            "settings.studio_updated",
            Some("studio_settings"),
            Some(1),
            "{}",
        )?;

        self.studio_settings()
    }

    pub fn assert_admin(&self, user_id: i64) -> DbResult<()> {
        let user = self.get_user(user_id)?.ok_or(DbError::Forbidden)?;

        if user.active && user.role.is_admin() {
            Ok(())
        } else {
            Err(DbError::Forbidden)
        }
    }

    pub fn assert_active_user(&self, user_id: i64) -> DbResult<()> {
        let user = self.get_user(user_id)?.ok_or(DbError::Forbidden)?;

        if user.active {
            Ok(())
        } else {
            Err(DbError::Forbidden)
        }
    }

    pub fn create_patient(
        &self,
        actor_user_id: i64,
        patient: &NewPatient<'_>,
    ) -> DbResult<Patient> {
        self.assert_active_user(actor_user_id)?;
        let id = self.insert_patient(patient)?;
        self.insert_patient_audit(actor_user_id, id, "patient.created", "{}")?;

        self.get_patient(id)?
            .ok_or_else(|| DbError::Sql("created patient was not found".to_owned()))
    }

    pub fn insert_patient(&self, patient: &NewPatient<'_>) -> DbResult<i64> {
        let tax_code = normalize_tax_code(patient.tax_code)?;
        let phone = normalize_optional(patient.phone);
        let email = normalize_optional(patient.email);
        let address = normalize_optional(patient.address);

        self.conn.execute(
            r#"
            INSERT INTO patients (
                first_name,
                last_name,
                tax_code,
                date_of_birth,
                phone,
                email,
                address
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                patient.first_name.trim(),
                patient.last_name.trim(),
                tax_code,
                patient.date_of_birth.trim(),
                phone.as_deref(),
                email.as_deref(),
                address.as_deref(),
            ],
        )?;

        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_patient(
        &self,
        actor_user_id: i64,
        patient_id: i64,
        patient: &NewPatient<'_>,
    ) -> DbResult<Patient> {
        self.assert_active_user(actor_user_id)?;
        let tax_code = normalize_tax_code(patient.tax_code)?;
        let phone = normalize_optional(patient.phone);
        let email = normalize_optional(patient.email);
        let address = normalize_optional(patient.address);

        let affected = self.conn.execute(
            r#"
            UPDATE patients
            SET
                first_name = ?1,
                last_name = ?2,
                tax_code = ?3,
                date_of_birth = ?4,
                phone = ?5,
                email = ?6,
                address = ?7,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?8 AND deleted_at IS NULL
            "#,
            params![
                patient.first_name.trim(),
                patient.last_name.trim(),
                tax_code,
                patient.date_of_birth.trim(),
                phone.as_deref(),
                email.as_deref(),
                address.as_deref(),
                patient_id,
            ],
        )?;

        if affected == 0 {
            return Err(DbError::NotFound);
        }

        self.insert_patient_audit(actor_user_id, patient_id, "patient.updated", "{}")?;
        self.get_patient(patient_id)?.ok_or(DbError::NotFound)
    }

    pub fn delete_patient(&self, actor_user_id: i64, patient_id: i64) -> DbResult<Patient> {
        self.assert_active_user(actor_user_id)?;
        let patient = self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;

        let affected = self.conn.execute(
            r#"
            UPDATE patients
            SET
                deleted_at = COALESCE(deleted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            [patient_id],
        )?;

        if affected == 0 {
            return Err(DbError::NotFound);
        }

        self.insert_patient_audit(actor_user_id, patient_id, "patient.deleted", "{}")?;
        Ok(patient)
    }

    pub fn open_patient_record(&self, actor_user_id: i64, patient_id: i64) -> DbResult<Patient> {
        self.assert_active_user(actor_user_id)?;
        let patient = self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        self.insert_patient_audit(actor_user_id, patient_id, "PATIENT_RECORD_VIEW", "{}")?;
        Ok(patient)
    }

    pub fn patient_timeline(
        &self,
        actor_user_id: i64,
        patient_id: i64,
    ) -> DbResult<Vec<PatientTimelineEvent>> {
        self.assert_active_user(actor_user_id)?;
        let patient = self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        let mut events = vec![PatientTimelineEvent {
            action: "patient.created".to_owned(),
            created_at: patient.created_at.clone(),
        }];

        if patient.updated_at != patient.created_at {
            events.push(PatientTimelineEvent {
                action: "patient.updated".to_owned(),
                created_at: patient.updated_at.clone(),
            });
        }

        let mut statement = self.conn.prepare(
            r#"
            SELECT action, created_at
            FROM audit_log
            WHERE patient_id = ?1
            ORDER BY created_at DESC
            LIMIT 25
            "#,
        )?;

        let mut audit_events = statement
            .query_map([patient_id], |row| {
                Ok(PatientTimelineEvent {
                    action: row.get(0)?,
                    created_at: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        events.append(&mut audit_events);
        events.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(events)
    }

    pub fn open_clinical_view(&self, actor_user_id: i64, patient_id: i64) -> DbResult<()> {
        self.assert_active_user(actor_user_id)?;
        self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        self.insert_patient_audit(actor_user_id, patient_id, "CLINICAL_VIEW_OPENED", "{}")
    }

    pub fn list_clinical_services(&self, actor_user_id: i64) -> DbResult<Vec<ClinicalService>> {
        self.assert_active_user(actor_user_id)?;
        let mut statement = self.conn.prepare(
            r#"
            SELECT id, code, name, category, base_price_cents, active
            FROM clinical_services_catalog
            WHERE active = 1
            ORDER BY category ASC, name ASC
            "#,
        )?;

        let services = statement
            .query_map([], clinical_service_from_row)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(DbError::from)?;
        Ok(services)
    }

    pub fn get_tooth_statuses(
        &self,
        actor_user_id: i64,
        patient_id: i64,
    ) -> DbResult<Vec<ToothStatus>> {
        self.assert_active_user(actor_user_id)?;
        self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        let mut statement = self.conn.prepare(
            r#"
            SELECT patient_id, tooth_number, state, updated_by_user_id, updated_at
            FROM clinical_tooth_statuses
            WHERE patient_id = ?1
            ORDER BY tooth_number ASC
            "#,
        )?;

        let statuses = statement
            .query_map([patient_id], tooth_status_from_row)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(DbError::from)?;
        Ok(statuses)
    }

    pub fn set_tooth_status(
        &self,
        actor_user_id: i64,
        patient_id: i64,
        tooth_number: i64,
        state: &str,
    ) -> DbResult<ToothStatus> {
        self.assert_active_user(actor_user_id)?;
        self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        validate_tooth_number(tooth_number)?;
        let state = normalize_tooth_state(state)?;

        self.conn.execute(
            r#"
            INSERT INTO clinical_tooth_statuses (
                patient_id,
                tooth_number,
                state,
                updated_by_user_id
            )
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(patient_id, tooth_number) DO UPDATE SET
                state = excluded.state,
                updated_by_user_id = excluded.updated_by_user_id,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            params![patient_id, tooth_number, state, actor_user_id],
        )?;

        self.insert_patient_audit(
            actor_user_id,
            patient_id,
            "clinical.tooth_status_updated",
            &format!(r#"{{"tooth_number":{tooth_number},"state":"{state}"}}"#),
        )?;

        self.get_tooth_status(patient_id, tooth_number)?
            .ok_or(DbError::NotFound)
    }

    pub fn create_clinical_record(
        &self,
        actor_user_id: i64,
        input: &NewClinicalRecord<'_>,
    ) -> DbResult<ClinicalRecord> {
        self.assert_active_user(actor_user_id)?;
        self.get_patient(input.patient_id)?
            .ok_or(DbError::NotFound)?;
        if let Some(tooth_number) = input.tooth_number {
            validate_tooth_number(tooth_number)?;
        }
        let status = normalize_clinical_status(input.status)?;
        if let Some(service_id) = input.service_id {
            self.get_clinical_service(service_id)?
                .ok_or(DbError::NotFound)?;
        }

        let tooth_surface = normalize_optional(input.tooth_surface);
        let pathology_description = normalize_optional(input.pathology_description);
        let notes = normalize_optional(input.notes);
        let ready_for_quote = if status == "diagnosed" {
            input.ready_for_quote
        } else {
            false
        };

        self.conn.execute(
            r#"
            INSERT INTO clinical_records (
                patient_id,
                service_id,
                tooth_number,
                tooth_surface,
                pathology_description,
                status,
                ready_for_quote,
                notes,
                created_by_user_id
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                input.patient_id,
                input.service_id,
                input.tooth_number,
                tooth_surface.as_deref(),
                pathology_description.as_deref(),
                status,
                ready_for_quote as i64,
                notes.as_deref(),
                actor_user_id,
            ],
        )?;

        let record_id = self.conn.last_insert_rowid();
        if let Some(tooth_number) = input.tooth_number {
            let derived_state = tooth_state_for_clinical_status(status);
            self.upsert_tooth_status_without_audit(
                input.patient_id,
                tooth_number,
                derived_state,
                actor_user_id,
            )?;
        }

        self.insert_patient_audit(
            actor_user_id,
            input.patient_id,
            "clinical.record_created",
            &clinical_audit_metadata(input.tooth_number, input.service_id, status),
        )?;

        self.get_clinical_record(record_id)?
            .ok_or(DbError::NotFound)
    }

    pub fn list_clinical_records(
        &self,
        actor_user_id: i64,
        patient_id: i64,
        filters: &ClinicalRecordFilters<'_>,
    ) -> DbResult<Vec<ClinicalRecord>> {
        self.assert_active_user(actor_user_id)?;
        self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        if let Some(tooth_number) = filters.tooth_number {
            validate_tooth_number(tooth_number)?;
        }

        let mut statement = self.conn.prepare(
            r#"
            SELECT
                cr.id,
                cr.patient_id,
                cr.service_id,
                sc.code,
                sc.name,
                cr.tooth_number,
                cr.tooth_surface,
                cr.pathology_description,
                cr.status,
                cr.ready_for_quote,
                cr.notes,
                cr.created_by_user_id,
                users.username,
                cr.created_at,
                cr.updated_at
            FROM clinical_records cr
            LEFT JOIN clinical_services_catalog sc ON sc.id = cr.service_id
            LEFT JOIN users ON users.id = cr.created_by_user_id
            WHERE
                cr.patient_id = ?1
                AND (?2 IS NULL OR cr.created_at >= ?2)
                AND (?3 IS NULL OR cr.created_at <= ?3)
                AND (?4 IS NULL OR cr.tooth_number = ?4)
                AND (?5 IS NULL OR cr.created_by_user_id = ?5)
            ORDER BY cr.created_at DESC
            LIMIT 200
            "#,
        )?;

        let records = statement
            .query_map(
                params![
                    patient_id,
                    filters.date_from,
                    filters.date_to,
                    filters.tooth_number,
                    filters.operator_user_id
                ],
                clinical_record_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()
            .map_err(DbError::from)?;
        Ok(records)
    }

    pub fn mark_clinical_record_ready_for_quote(
        &self,
        actor_user_id: i64,
        record_id: i64,
        ready_for_quote: bool,
    ) -> DbResult<ClinicalRecord> {
        self.assert_active_user(actor_user_id)?;
        let record = self
            .get_clinical_record(record_id)?
            .ok_or(DbError::NotFound)?;
        if record.status != "diagnosed" {
            return Err(DbError::InvalidClinicalStatus(record.status));
        }

        self.conn.execute(
            r#"
            UPDATE clinical_records
            SET
                ready_for_quote = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            "#,
            params![ready_for_quote as i64, record_id],
        )?;

        self.insert_patient_audit(
            actor_user_id,
            record.patient_id,
            "clinical.record_quote_flag_updated",
            &format!(
                r#"{{"record_id":{record_id},"tooth_number":{},"ready_for_quote":{}}}"#,
                record
                    .tooth_number
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "null".to_owned()),
                ready_for_quote
            ),
        )?;

        self.get_clinical_record(record_id)?
            .ok_or(DbError::NotFound)
    }

    pub fn chair_config(&self, actor_user_id: i64) -> DbResult<ChairConfig> {
        self.assert_active_user(actor_user_id)?;
        Ok(ChairConfig {
            chair_count: self.studio_settings()?.chair_count,
        })
    }

    pub fn list_appointments(
        &self,
        actor_user_id: i64,
        starts_from: &str,
        starts_to: &str,
    ) -> DbResult<Vec<Appointment>> {
        self.assert_active_user(actor_user_id)?;
        let mut statement = self.conn.prepare(
            r#"
            SELECT
                appointments.id,
                appointments.patient_id,
                CASE
                    WHEN patients.id IS NULL THEN NULL
                    ELSE patients.last_name || ' ' || patients.first_name
                END AS patient_name,
                appointments.chair_number,
                appointments.title,
                appointments.starts_at,
                appointments.ends_at,
                appointments.status,
                appointments.color_tag,
                appointments.google_calendar_event_id,
                appointments.last_google_sync_at,
                appointments.created_at,
                appointments.updated_at
            FROM appointments
            LEFT JOIN patients ON patients.id = appointments.patient_id
            WHERE appointments.starts_at >= ?1 AND appointments.starts_at < ?2
            ORDER BY appointments.starts_at ASC, appointments.chair_number ASC
            "#,
        )?;

        let appointments = statement
            .query_map(
                params![starts_from.trim(), starts_to.trim()],
                appointment_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()
            .map_err(DbError::from)?;
        Ok(appointments)
    }

    pub fn create_appointment(
        &self,
        actor_user_id: i64,
        input: &AppointmentInput<'_>,
    ) -> DbResult<Appointment> {
        self.assert_active_user(actor_user_id)?;
        self.validate_appointment_input(input, None)?;

        let result = (|| {
            self.conn.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;
            let status = normalize_appointment_status(input.status)?;
            let color_tag = normalize_optional(input.color_tag);
            let notes = normalize_optional(input.notes);
            let title = input.title.trim();
            self.assert_no_appointment_conflict(
                input.chair_number,
                input.starts_at,
                input.ends_at,
                None,
            )?;

            self.conn.execute(
                r#"
                INSERT INTO appointments (
                    patient_id,
                    chair_number,
                    title,
                    starts_at,
                    ends_at,
                    status,
                    color_tag,
                    notes
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    input.patient_id,
                    input.chair_number,
                    title,
                    input.starts_at.trim(),
                    input.ends_at.trim(),
                    status,
                    color_tag.as_deref(),
                    notes.as_deref()
                ],
            )?;

            let appointment_id = self.conn.last_insert_rowid();
            self.enqueue_google_calendar_sync_without_tx(appointment_id)?;
            self.insert_appointment_audit(
                actor_user_id,
                input.patient_id,
                appointment_id,
                "agenda.appointment_created",
                &format!(
                    r#"{{"appointment_id":{appointment_id},"chair_number":{},"status":"{}"}}"#,
                    input.chair_number, status
                ),
            )?;
            self.conn.execute_batch("COMMIT")?;
            Ok(appointment_id)
        })();

        match result {
            Ok(appointment_id) => self
                .get_appointment(appointment_id)?
                .ok_or(DbError::NotFound),
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn move_appointment(
        &self,
        actor_user_id: i64,
        appointment_id: i64,
        starts_at: &str,
        ends_at: &str,
        chair_number: i64,
    ) -> DbResult<Appointment> {
        self.assert_active_user(actor_user_id)?;
        if starts_at.trim() >= ends_at.trim() {
            return Err(DbError::InvalidAppointmentTimeRange);
        }
        self.validate_chair_number(chair_number)?;
        self.assert_no_appointment_conflict(
            chair_number,
            starts_at,
            ends_at,
            Some(appointment_id),
        )?;
        let existing = self
            .get_appointment(appointment_id)?
            .ok_or(DbError::NotFound)?;

        let result = (|| {
            self.conn.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;
            self.assert_no_appointment_conflict(
                chair_number,
                starts_at,
                ends_at,
                Some(appointment_id),
            )?;
            let affected = self.conn.execute(
                r#"
                UPDATE appointments
                SET
                    chair_number = ?1,
                    starts_at = ?2,
                    ends_at = ?3,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?4
                "#,
                params![
                    chair_number,
                    starts_at.trim(),
                    ends_at.trim(),
                    appointment_id
                ],
            )?;
            if affected == 0 {
                return Err(DbError::NotFound);
            }
            self.enqueue_google_calendar_sync_without_tx(appointment_id)?;
            self.insert_appointment_audit(
                actor_user_id,
                existing.patient_id,
                appointment_id,
                "agenda.appointment_moved",
                &format!(
                    r#"{{"appointment_id":{appointment_id},"chair_number":{chair_number},"starts_at":"{}","ends_at":"{}"}}"#,
                    starts_at.trim(),
                    ends_at.trim()
                ),
            )?;
            self.conn.execute_batch("COMMIT")?;
            Ok(())
        })();

        match result {
            Ok(()) => self
                .get_appointment(appointment_id)?
                .ok_or(DbError::NotFound),
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn update_appointment_status(
        &self,
        actor_user_id: i64,
        appointment_id: i64,
        status: &str,
    ) -> DbResult<Appointment> {
        self.assert_active_user(actor_user_id)?;
        let status = normalize_appointment_status(status)?;
        let existing = self
            .get_appointment(appointment_id)?
            .ok_or(DbError::NotFound)?;
        self.conn.execute(
            r#"
            UPDATE appointments
            SET status = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            "#,
            params![status, appointment_id],
        )?;
        self.enqueue_google_calendar_sync_without_tx(appointment_id)?;
        self.insert_appointment_audit(
            actor_user_id,
            existing.patient_id,
            appointment_id,
            "agenda.appointment_status_updated",
            &format!(r#"{{"appointment_id":{appointment_id},"status":"{status}"}}"#),
        )?;

        self.get_appointment(appointment_id)?
            .ok_or(DbError::NotFound)
    }

    pub fn google_calendar_sync_status(
        &self,
        actor_user_id: i64,
    ) -> DbResult<GoogleCalendarSyncStatus> {
        self.assert_admin(actor_user_id)?;
        let connected: i64 = self.conn.query_row(
            r#"
            SELECT COUNT(*)
            FROM integration_accounts
            WHERE integration_type = 'google_calendar' AND label = 'primary' AND active = 1
            "#,
            [],
            |row| row.get(0),
        )?;
        let queued_jobs: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sync_jobs WHERE integration_type = 'google_calendar' AND status = 'queued'",
            [],
            |row| row.get(0),
        )?;
        let failed_jobs: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sync_jobs WHERE integration_type = 'google_calendar' AND status = 'failed'",
            [],
            |row| row.get(0),
        )?;
        let last_sync_at: Option<String> = self.conn.query_row(
            "SELECT MAX(last_google_sync_at) FROM appointments",
            [],
            |row| row.get(0),
        )?;

        Ok(GoogleCalendarSyncStatus {
            configured: google::oauth_status().configured,
            connected: connected > 0,
            queued_jobs,
            failed_jobs,
            last_sync_at,
        })
    }

    pub fn store_google_calendar_token(
        &self,
        actor_user_id: i64,
        token_json: &str,
    ) -> DbResult<()> {
        self.assert_admin(actor_user_id)?;
        self.conn.execute(
            r#"
            INSERT INTO integration_accounts (integration_type, label, config_json, active)
            VALUES ('google_calendar', 'primary', ?1, 1)
            ON CONFLICT(integration_type, label) DO UPDATE SET
                config_json = excluded.config_json,
                active = 1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            [token_json],
        )?;
        self.insert_audit(
            Some(actor_user_id),
            None,
            "settings.google_calendar_connected",
            Some("integration_accounts"),
            None,
            "{}",
        )
    }

    pub fn google_calendar_token_json(&self, actor_user_id: i64) -> DbResult<String> {
        self.assert_admin(actor_user_id)?;
        self.conn
            .query_row(
                r#"
                SELECT config_json
                FROM integration_accounts
                WHERE integration_type = 'google_calendar' AND label = 'primary' AND active = 1
                "#,
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(DbError::GoogleCalendarNotConnected)
    }

    pub fn pending_google_calendar_sync_jobs(
        &self,
        actor_user_id: i64,
        limit: i64,
    ) -> DbResult<Vec<GoogleCalendarSyncJob>> {
        self.assert_admin(actor_user_id)?;
        let normalized_limit = limit.clamp(1, 25);
        let mut statement = self.conn.prepare(
            r#"
            SELECT
                sync_jobs.id,
                appointments.id,
                appointments.patient_id,
                CASE
                    WHEN patients.id IS NULL THEN NULL
                    ELSE patients.last_name || ' ' || patients.first_name
                END AS patient_name,
                appointments.chair_number,
                appointments.title,
                appointments.starts_at,
                appointments.ends_at,
                appointments.status,
                appointments.color_tag,
                appointments.google_calendar_event_id,
                appointments.last_google_sync_at,
                appointments.created_at,
                appointments.updated_at
            FROM sync_jobs
            INNER JOIN appointments ON appointments.id = sync_jobs.entity_id
            LEFT JOIN patients ON patients.id = appointments.patient_id
            WHERE
                sync_jobs.integration_type = 'google_calendar'
                AND sync_jobs.entity_type = 'appointment'
                AND sync_jobs.status = 'queued'
                AND (sync_jobs.run_after IS NULL OR sync_jobs.run_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ORDER BY sync_jobs.created_at ASC
            LIMIT ?1
            "#,
        )?;

        let jobs = statement
            .query_map([normalized_limit], |row| {
                Ok(GoogleCalendarSyncJob {
                    job_id: row.get(0)?,
                    appointment: appointment_from_offset_row(row, 1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(DbError::from)?;
        Ok(jobs)
    }

    pub fn complete_google_calendar_sync_job(
        &self,
        job_id: i64,
        appointment_id: i64,
        google_event_id: &str,
    ) -> DbResult<()> {
        self.conn.execute(
            r#"
            UPDATE appointments
            SET
                google_calendar_event_id = ?1,
                last_google_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            "#,
            params![google_event_id, appointment_id],
        )?;
        self.conn.execute(
            r#"
            UPDATE sync_jobs
            SET
                status = 'completed',
                attempts = attempts + 1,
                last_error = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
            [job_id],
        )?;
        Ok(())
    }

    pub fn fail_google_calendar_sync_job(&self, job_id: i64, error_message: &str) -> DbResult<()> {
        let sanitized = sanitize_sync_error(error_message);
        self.conn.execute(
            r#"
            UPDATE sync_jobs
            SET
                status = 'failed',
                attempts = attempts + 1,
                last_error = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            "#,
            params![sanitized, job_id],
        )?;
        Ok(())
    }

    pub fn get_patient(&self, id: i64) -> DbResult<Option<Patient>> {
        self.conn
            .query_row(
                r#"
                SELECT
                    id,
                    first_name,
                    last_name,
                    tax_code,
                    date_of_birth,
                    phone,
                    email,
                    address,
                    privacy_consent_signed,
                    created_at,
                    updated_at
                FROM patients
                WHERE id = ?1 AND deleted_at IS NULL
                "#,
                [id],
                patient_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    pub fn search_patients(&self, query: &str, limit: i64) -> DbResult<Vec<Patient>> {
        let normalized_limit = limit.clamp(1, 25);
        let pattern = format!("%{}%", query.trim());

        let mut statement = self.conn.prepare(
            r#"
            SELECT
                id,
                first_name,
                last_name,
                tax_code,
                date_of_birth,
                phone,
                email,
                address,
                privacy_consent_signed,
                created_at,
                updated_at
            FROM patients
            WHERE
                deleted_at IS NULL
                AND (
                    ?1 = '%%'
                    OR first_name LIKE ?1
                    OR last_name LIKE ?1
                    OR tax_code LIKE ?1
                )
            ORDER BY last_name ASC, first_name ASC
            LIMIT ?2
            "#,
        )?;

        let patients = statement
            .query_map(params![pattern, normalized_limit], patient_from_row)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(patients)
    }

    pub fn ensure_development_patient(&self) -> DbResult<Patient> {
        self.upsert_test_patient()
    }

    pub fn upsert_test_patient(&self) -> DbResult<Patient> {
        let tax_code = "RSSMRA85M01H501Q";

        if let Some(existing) = self.find_patient_by_tax_code(tax_code)? {
            return Ok(existing);
        }

        let id = self.insert_patient(&NewPatient {
            first_name: "Mario",
            last_name: "Rossi",
            tax_code,
            date_of_birth: "1985-08-01",
            phone: None,
            email: None,
            address: None,
        })?;

        self.conn.execute(
            r#"
            INSERT INTO audit_log (
                action,
                entity_type,
                entity_id,
                metadata_json
            )
            VALUES ('patient.test_inserted', 'patients', ?1, '{"source":"repository_smoke_test"}')
            "#,
            [id],
        )?;

        self.get_patient(id)?
            .ok_or_else(|| DbError::Sql("test patient insert did not return a row".to_owned()))
    }

    fn find_patient_by_tax_code(&self, tax_code: &str) -> DbResult<Option<Patient>> {
        self.conn
            .query_row(
                r#"
                SELECT
                    id,
                    first_name,
                    last_name,
                    tax_code,
                    date_of_birth,
                    phone,
                    email,
                    address,
                    privacy_consent_signed,
                    created_at,
                    updated_at
                FROM patients
                WHERE tax_code = ?1 AND deleted_at IS NULL
                "#,
                [tax_code],
                patient_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn has_admin_user(&self) -> DbResult<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1",
            [],
            |row| row.get(0),
        )?;

        Ok(count > 0)
    }

    fn get_user(&self, id: i64) -> DbResult<Option<User>> {
        self.conn
            .query_row(
                r#"
                SELECT id, username, google_email, role, active, created_at, updated_at
                FROM users
                WHERE id = ?1
                "#,
                [id],
                user_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn get_authorized_google_account(
        &self,
        email: &str,
    ) -> DbResult<Option<AuthorizedGoogleAccount>> {
        self.conn
            .query_row(
                r#"
                SELECT id, email, role, active, created_at, updated_at
                FROM authorized_google_accounts
                WHERE email = ?1
                "#,
                [email],
                google_account_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn get_device(&self, id: i64) -> DbResult<Option<AuthorizedDevice>> {
        self.conn
            .query_row(
                r#"
                SELECT
                    id,
                    user_id,
                    label,
                    allowed_lan_cidr,
                    revoked_at,
                    expires_at,
                    last_seen_at,
                    created_at,
                    updated_at
                FROM authorized_devices
                WHERE id = ?1
                "#,
                [id],
                device_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn get_clinical_service(&self, id: i64) -> DbResult<Option<ClinicalService>> {
        self.conn
            .query_row(
                r#"
                SELECT id, code, name, category, base_price_cents, active
                FROM clinical_services_catalog
                WHERE id = ?1 AND active = 1
                "#,
                [id],
                clinical_service_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn get_tooth_status(
        &self,
        patient_id: i64,
        tooth_number: i64,
    ) -> DbResult<Option<ToothStatus>> {
        self.conn
            .query_row(
                r#"
                SELECT patient_id, tooth_number, state, updated_by_user_id, updated_at
                FROM clinical_tooth_statuses
                WHERE patient_id = ?1 AND tooth_number = ?2
                "#,
                params![patient_id, tooth_number],
                tooth_status_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn upsert_tooth_status_without_audit(
        &self,
        patient_id: i64,
        tooth_number: i64,
        state: &str,
        actor_user_id: i64,
    ) -> DbResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO clinical_tooth_statuses (
                patient_id,
                tooth_number,
                state,
                updated_by_user_id
            )
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(patient_id, tooth_number) DO UPDATE SET
                state = excluded.state,
                updated_by_user_id = excluded.updated_by_user_id,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            params![patient_id, tooth_number, state, actor_user_id],
        )?;

        Ok(())
    }

    fn get_clinical_record(&self, id: i64) -> DbResult<Option<ClinicalRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT
                    cr.id,
                    cr.patient_id,
                    cr.service_id,
                    sc.code,
                    sc.name,
                    cr.tooth_number,
                    cr.tooth_surface,
                    cr.pathology_description,
                    cr.status,
                    cr.ready_for_quote,
                    cr.notes,
                    cr.created_by_user_id,
                    users.username,
                    cr.created_at,
                    cr.updated_at
                FROM clinical_records cr
                LEFT JOIN clinical_services_catalog sc ON sc.id = cr.service_id
                LEFT JOIN users ON users.id = cr.created_by_user_id
                WHERE cr.id = ?1
                "#,
                [id],
                clinical_record_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn get_appointment(&self, id: i64) -> DbResult<Option<Appointment>> {
        self.conn
            .query_row(
                r#"
                SELECT
                    appointments.id,
                    appointments.patient_id,
                    CASE
                        WHEN patients.id IS NULL THEN NULL
                        ELSE patients.last_name || ' ' || patients.first_name
                    END AS patient_name,
                    appointments.chair_number,
                    appointments.title,
                    appointments.starts_at,
                    appointments.ends_at,
                    appointments.status,
                    appointments.color_tag,
                    appointments.google_calendar_event_id,
                    appointments.last_google_sync_at,
                    appointments.created_at,
                    appointments.updated_at
                FROM appointments
                LEFT JOIN patients ON patients.id = appointments.patient_id
                WHERE appointments.id = ?1
                "#,
                [id],
                appointment_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    fn validate_appointment_input(
        &self,
        input: &AppointmentInput<'_>,
        excluded_appointment_id: Option<i64>,
    ) -> DbResult<()> {
        if input.title.trim().is_empty() || input.starts_at.trim() >= input.ends_at.trim() {
            return Err(DbError::InvalidAppointmentTimeRange);
        }
        normalize_appointment_status(input.status)?;
        self.validate_chair_number(input.chair_number)?;
        if let Some(patient_id) = input.patient_id {
            self.get_patient(patient_id)?.ok_or(DbError::NotFound)?;
        }
        self.assert_no_appointment_conflict(
            input.chair_number,
            input.starts_at,
            input.ends_at,
            excluded_appointment_id,
        )
    }

    fn validate_chair_number(&self, chair_number: i64) -> DbResult<()> {
        let chair_count = self.studio_settings()?.chair_count;
        if chair_number >= 1 && chair_number <= chair_count {
            Ok(())
        } else {
            Err(DbError::InvalidAppointmentTimeRange)
        }
    }

    fn assert_no_appointment_conflict(
        &self,
        chair_number: i64,
        starts_at: &str,
        ends_at: &str,
        excluded_appointment_id: Option<i64>,
    ) -> DbResult<()> {
        let conflict_count: i64 = self.conn.query_row(
            r#"
            SELECT COUNT(*)
            FROM appointments
            WHERE
                chair_number = ?1
                AND status != 'cancelled'
                AND starts_at < ?3
                AND ends_at > ?2
                AND (?4 IS NULL OR id != ?4)
            "#,
            params![
                chair_number,
                starts_at.trim(),
                ends_at.trim(),
                excluded_appointment_id
            ],
            |row| row.get(0),
        )?;

        if conflict_count == 0 {
            Ok(())
        } else {
            Err(DbError::AppointmentConflict)
        }
    }

    fn enqueue_google_calendar_sync_without_tx(&self, appointment_id: i64) -> DbResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO sync_jobs (integration_type, entity_type, entity_id, status)
            VALUES ('google_calendar', 'appointment', ?1, 'queued')
            "#,
            [appointment_id],
        )?;
        Ok(())
    }

    fn insert_appointment_audit(
        &self,
        user_id: i64,
        patient_id: Option<i64>,
        appointment_id: i64,
        action: &str,
        metadata_json: &str,
    ) -> DbResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO audit_log (
                user_id,
                patient_id,
                action,
                entity_type,
                entity_id,
                metadata_json
            )
            VALUES (?1, ?2, ?3, 'appointments', ?4, ?5)
            "#,
            params![user_id, patient_id, action, appointment_id, metadata_json],
        )?;

        Ok(())
    }

    fn insert_audit(
        &self,
        user_id: Option<i64>,
        device_id: Option<i64>,
        action: &str,
        entity_type: Option<&str>,
        entity_id: Option<i64>,
        metadata_json: &str,
    ) -> DbResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO audit_log (
                user_id,
                device_id,
                action,
                entity_type,
                entity_id,
                metadata_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                user_id,
                device_id,
                action,
                entity_type,
                entity_id,
                metadata_json
            ],
        )?;

        Ok(())
    }

    fn insert_patient_audit(
        &self,
        user_id: i64,
        patient_id: i64,
        action: &str,
        metadata_json: &str,
    ) -> DbResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO audit_log (
                user_id,
                patient_id,
                action,
                entity_type,
                entity_id,
                metadata_json
            )
            VALUES (?1, ?2, ?3, 'patients', ?2, ?4)
            "#,
            params![user_id, patient_id, action, metadata_json],
        )?;

        Ok(())
    }
}

pub fn validate_tax_code(tax_code: &str) -> bool {
    normalize_tax_code(tax_code).is_ok()
}

fn normalize_tax_code(tax_code: &str) -> DbResult<String> {
    let normalized = tax_code.trim().to_ascii_uppercase();

    if normalized.len() != 16
        || !normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err(DbError::InvalidTaxCode);
    }

    let chars = normalized.chars().collect::<Vec<_>>();
    let valid_shape = chars[..6]
        .iter()
        .all(|character| character.is_ascii_alphabetic())
        && matches!(
            chars[8],
            'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'L' | 'M' | 'P' | 'R' | 'S' | 'T'
        )
        && chars[11].is_ascii_alphabetic()
        && chars[15].is_ascii_alphabetic();

    if !valid_shape {
        return Err(DbError::InvalidTaxCode);
    }

    let mut checksum = 0;
    for (index, character) in chars.iter().take(15).enumerate() {
        checksum += if index % 2 == 0 {
            odd_tax_code_value(*character).ok_or(DbError::InvalidTaxCode)?
        } else {
            even_tax_code_value(*character).ok_or(DbError::InvalidTaxCode)?
        };
    }

    let expected = (b'A' + (checksum % 26) as u8) as char;
    if expected != chars[15] {
        return Err(DbError::InvalidTaxCode);
    }

    Ok(normalized)
}

fn even_tax_code_value(character: char) -> Option<i32> {
    if character.is_ascii_digit() {
        character.to_digit(10).map(|value| value as i32)
    } else if character.is_ascii_uppercase() {
        Some((character as u8 - b'A') as i32)
    } else {
        None
    }
}

fn odd_tax_code_value(character: char) -> Option<i32> {
    Some(match character {
        '0' | 'A' => 1,
        '1' | 'B' => 0,
        '2' | 'C' => 5,
        '3' | 'D' => 7,
        '4' | 'E' => 9,
        '5' | 'F' => 13,
        '6' | 'G' => 15,
        '7' | 'H' => 17,
        '8' | 'I' => 19,
        '9' | 'J' => 21,
        'K' => 2,
        'L' => 4,
        'M' => 18,
        'N' => 20,
        'O' => 11,
        'P' => 3,
        'Q' => 6,
        'R' => 8,
        'S' => 12,
        'T' => 14,
        'U' => 16,
        'V' => 10,
        'W' => 22,
        'X' => 25,
        'Y' => 24,
        'Z' => 23,
        _ => return None,
    })
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn validate_tooth_number(tooth_number: i64) -> DbResult<()> {
    let quadrant = tooth_number / 10;
    let position = tooth_number % 10;

    if (1..=4).contains(&quadrant) && (1..=8).contains(&position) {
        Ok(())
    } else {
        Err(DbError::InvalidToothNumber)
    }
}

fn normalize_tooth_state(state: &str) -> DbResult<String> {
    match state.trim() {
        "healthy" | "pathology" | "in_progress" | "performed" | "caries" | "endodontics_needed"
        | "crown_needed" | "extraction_needed" | "filling_done" | "root_canal_done"
        | "crown_done" | "implant_done" | "missing" => Ok(state.trim().to_owned()),
        value => Err(DbError::InvalidToothState(value.to_owned())),
    }
}

fn normalize_clinical_status(status: &str) -> DbResult<&'static str> {
    match status.trim() {
        "diagnosed" => Ok("diagnosed"),
        "in_quote" => Ok("in_quote"),
        "performed" => Ok("performed"),
        value => Err(DbError::InvalidClinicalStatus(value.to_owned())),
    }
}

fn normalize_appointment_status(status: &str) -> DbResult<&'static str> {
    match status.trim() {
        "booked" => Ok("booked"),
        "arrived" => Ok("arrived"),
        "waiting" => Ok("waiting"),
        "in_chair" => Ok("in_chair"),
        "completed" => Ok("completed"),
        "cancelled" => Ok("cancelled"),
        "missed" => Ok("missed"),
        value => Err(DbError::InvalidAppointmentStatus(value.to_owned())),
    }
}

fn sanitize_sync_error(error_message: &str) -> String {
    error_message
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect()
}

fn tooth_state_for_clinical_status(status: &str) -> &'static str {
    match status {
        "performed" => "performed",
        "in_quote" => "in_progress",
        _ => "pathology",
    }
}

fn clinical_audit_metadata(
    tooth_number: Option<i64>,
    service_id: Option<i64>,
    status: &str,
) -> String {
    format!(
        r#"{{"tooth_number":{},"service_id":{},"status":"{}"}}"#,
        tooth_number
            .map(|value| value.to_string())
            .unwrap_or_else(|| "null".to_owned()),
        service_id
            .map(|value| value.to_string())
            .unwrap_or_else(|| "null".to_owned()),
        status
    )
}

fn default_database_path() -> PathBuf {
    if let Ok(path) = env::var("VELODENT_DB_PATH") {
        return PathBuf::from(path);
    }

    env::current_dir()
        .unwrap_or_else(|_| Path::new(".").to_path_buf())
        .join("data")
        .join("velodent.sqlite")
}

fn configure_encryption(conn: &Connection, key: &str) -> DbResult<()> {
    conn.pragma_update(None, "key", key)?;
    conn.pragma_update(None, "cipher_page_size", 4096)?;
    conn.pragma_update(None, "kdf_iter", 256_000)?;
    conn.pragma_update(None, "cipher_hmac_algorithm", "HMAC_SHA512")?;
    conn.pragma_update(None, "cipher_kdf_algorithm", "PBKDF2_HMAC_SHA512")?;
    Ok(())
}

fn configure_connection(conn: &Connection) -> DbResult<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5_000)?;
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> DbResult<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    ensure_column(conn, "patients", "deleted_at", "TEXT")?;
    ensure_column(
        conn,
        "clinical_records",
        "ready_for_quote",
        "INTEGER NOT NULL DEFAULT 0 CHECK(ready_for_quote IN (0, 1))",
    )?;
    migrate_tooth_status_constraint(conn)?;
    conn.execute(
        r#"
        INSERT OR IGNORE INTO schema_migrations (version, name)
        VALUES (?1, ?2)
        "#,
        params![CURRENT_SCHEMA_VERSION, "sessions_and_granular_tooth_states"],
    )?;
    Ok(())
}

fn migrate_tooth_status_constraint(conn: &Connection) -> DbResult<()> {
    let table_sql = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'clinical_tooth_statuses'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();

    if table_sql.contains("caries") {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = OFF;
        ALTER TABLE clinical_tooth_statuses RENAME TO clinical_tooth_statuses_legacy;
        CREATE TABLE clinical_tooth_statuses (
            patient_id INTEGER NOT NULL,
            tooth_number INTEGER NOT NULL CHECK(tooth_number BETWEEN 11 AND 48),
            state TEXT NOT NULL CHECK(state IN (
                'healthy',
                'pathology',
                'in_progress',
                'performed',
                'caries',
                'endodontics_needed',
                'crown_needed',
                'extraction_needed',
                'filling_done',
                'root_canal_done',
                'crown_done',
                'implant_done',
                'missing'
            )),
            updated_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            PRIMARY KEY (patient_id, tooth_number),
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO clinical_tooth_statuses (
            patient_id,
            tooth_number,
            state,
            updated_by_user_id,
            created_at,
            updated_at
        )
        SELECT
            patient_id,
            tooth_number,
            state,
            updated_by_user_id,
            created_at,
            updated_at
        FROM clinical_tooth_statuses_legacy;
        DROP TABLE clinical_tooth_statuses_legacy;
        CREATE INDEX IF NOT EXISTS idx_clinical_tooth_statuses_patient ON clinical_tooth_statuses(patient_id);
        PRAGMA foreign_keys = ON;
        "#,
    )?;

    Ok(())
}

fn ensure_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> DbResult<()> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let exists = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column_name);

    if !exists {
        conn.execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
            [],
        )?;
    }

    Ok(())
}

fn patient_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Patient> {
    let privacy_consent_signed: i64 = row.get(8)?;

    Ok(Patient {
        id: row.get(0)?,
        first_name: row.get(1)?,
        last_name: row.get(2)?,
        tax_code: row.get(3)?,
        date_of_birth: row.get(4)?,
        phone: row.get(5)?,
        email: row.get(6)?,
        address: row.get(7)?,
        privacy_consent_signed: privacy_consent_signed == 1,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn clinical_service_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClinicalService> {
    let active: i64 = row.get(5)?;

    Ok(ClinicalService {
        id: row.get(0)?,
        code: row.get(1)?,
        name: row.get(2)?,
        category: row.get(3)?,
        base_price_cents: row.get(4)?,
        active: active == 1,
    })
}

fn tooth_status_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToothStatus> {
    Ok(ToothStatus {
        patient_id: row.get(0)?,
        tooth_number: row.get(1)?,
        state: row.get(2)?,
        updated_by_user_id: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn clinical_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClinicalRecord> {
    let ready_for_quote: i64 = row.get(9)?;

    Ok(ClinicalRecord {
        id: row.get(0)?,
        patient_id: row.get(1)?,
        service_id: row.get(2)?,
        service_code: row.get(3)?,
        service_name: row.get(4)?,
        tooth_number: row.get(5)?,
        tooth_surface: row.get(6)?,
        pathology_description: row.get(7)?,
        status: row.get(8)?,
        ready_for_quote: ready_for_quote == 1,
        notes: row.get(10)?,
        operator_user_id: row.get(11)?,
        operator_username: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn appointment_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Appointment> {
    appointment_from_offset_row(row, 0)
}

fn appointment_from_offset_row(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<Appointment> {
    Ok(Appointment {
        id: row.get(offset)?,
        patient_id: row.get(offset + 1)?,
        patient_name: row.get(offset + 2)?,
        chair_number: row.get(offset + 3)?,
        title: row.get(offset + 4)?,
        starts_at: row.get(offset + 5)?,
        ends_at: row.get(offset + 6)?,
        status: row.get(offset + 7)?,
        color_tag: row.get(offset + 8)?,
        google_calendar_event_id: row.get(offset + 9)?,
        last_google_sync_at: row.get(offset + 10)?,
        created_at: row.get(offset + 11)?,
        updated_at: row.get(offset + 12)?,
    })
}

fn user_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<User> {
    let role: String = row.get(3)?;
    let active: i64 = row.get(4)?;

    let role = Role::from_db_value(&role).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(DbError::InvalidRole(role)),
        )
    })?;

    Ok(User {
        id: row.get(0)?,
        username: row.get(1)?,
        google_email: row.get(2)?,
        role,
        active: active == 1,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn google_account_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuthorizedGoogleAccount> {
    let role: String = row.get(2)?;
    let active: i64 = row.get(3)?;

    let role = Role::from_db_value(&role).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(DbError::InvalidRole(role)),
        )
    })?;

    Ok(AuthorizedGoogleAccount {
        id: row.get(0)?,
        email: row.get(1)?,
        role,
        active: active == 1,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn device_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuthorizedDevice> {
    Ok(AuthorizedDevice {
        id: row.get(0)?,
        user_id: row.get(1)?,
        label: row.get(2)?,
        allowed_lan_cidr: row.get(3)?,
        revoked_at: row.get(4)?,
        expires_at: row.get(5)?,
        last_seen_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn studio_settings_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudioSettings> {
    Ok(StudioSettings {
        clinic_name: row.get(0)?,
        logo_relative_path: row.get(1)?,
        chair_count: row.get(2)?,
        data_directory: row.get(3)?,
        holiday_periods_json: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn parse_role(value: &str) -> DbResult<Role> {
    Role::from_db_value(value).ok_or_else(|| DbError::InvalidRole(value.to_owned()))
}

const SCHEMA_SQL: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    google_email TEXT UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'odontoiatra', 'aso')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS authorized_google_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'odontoiatra', 'aso')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS authorized_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    label TEXT NOT NULL,
    device_token_hash TEXT NOT NULL UNIQUE,
    allowed_lan_cidr TEXT,
    revoked_at TEXT,
    expires_at TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token_hash TEXT NOT NULL UNIQUE,
    revoked_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS studio_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    clinic_name TEXT,
    logo_relative_path TEXT,
    chair_count INTEGER NOT NULL DEFAULT 1 CHECK(chair_count > 0),
    data_directory TEXT,
    holiday_periods_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO studio_settings (id, chair_count) VALUES (1, 1);

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    tax_code TEXT NOT NULL UNIQUE,
    date_of_birth TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    privacy_consent_signed INTEGER NOT NULL DEFAULT 0 CHECK(privacy_consent_signed IN (0, 1)),
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    chair_number INTEGER NOT NULL DEFAULT 1 CHECK(chair_number > 0),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked', 'arrived', 'waiting', 'in_chair', 'completed', 'cancelled', 'missed')),
    color_tag TEXT,
    notes TEXT,
    google_calendar_event_id TEXT UNIQUE,
    last_google_sync_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS clinical_services_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    base_price_cents INTEGER NOT NULL CHECK(base_price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO clinical_services_catalog (code, name, category, base_price_cents)
VALUES
    ('ABL-001', 'Pulizia professionale', 'igiene', 7000),
    ('EXT-001', 'Estrazione semplice', 'chirurgia', 12000),
    ('OTT-001', 'Otturazione composito', 'conservativa', 9500),
    ('DEV-001', 'Devitalizzazione', 'endodonzia', 25000),
    ('VIS-001', 'Visita diagnostica', 'diagnosi', 5000);

CREATE TABLE IF NOT EXISTS clinical_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    service_id INTEGER,
    tooth_number INTEGER CHECK(tooth_number IS NULL OR (tooth_number BETWEEN 11 AND 48)),
    tooth_surface TEXT,
    pathology_description TEXT,
    status TEXT NOT NULL DEFAULT 'diagnosed' CHECK(status IN ('diagnosed', 'in_quote', 'performed')),
    ready_for_quote INTEGER NOT NULL DEFAULT 0 CHECK(ready_for_quote IN (0, 1)),
    notes TEXT,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES clinical_services_catalog(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS clinical_tooth_statuses (
    patient_id INTEGER NOT NULL,
    tooth_number INTEGER NOT NULL CHECK(tooth_number BETWEEN 11 AND 48),
    state TEXT NOT NULL CHECK(state IN (
        'healthy',
        'pathology',
        'in_progress',
        'performed',
        'caries',
        'endodontics_needed',
        'crown_needed',
        'extraction_needed',
        'filling_done',
        'root_canal_done',
        'crown_done',
        'implant_done',
        'missing'
    )),
    updated_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (patient_id, tooth_number),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS file_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    relative_path TEXT NOT NULL UNIQUE,
    file_kind TEXT NOT NULL CHECK(file_kind IN ('rx', 'consent', 'invoice', 'quote', 'other')),
    mime_type TEXT,
    sha256_hex TEXT,
    size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS patient_consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    consent_type TEXT NOT NULL,
    file_asset_id INTEGER,
    signed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (file_asset_id) REFERENCES file_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rx_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    file_asset_id INTEGER NOT NULL UNIQUE,
    rx_type TEXT NOT NULL CHECK(rx_type IN ('endoral', 'panoramic', 'cbct', 'photo')),
    tooth_number INTEGER,
    dicom_metadata_json TEXT NOT NULL DEFAULT '{}',
    acquired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (file_asset_id) REFERENCES file_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'accepted', 'rejected')),
    gross_total_cents INTEGER NOT NULL DEFAULT 0 CHECK(gross_total_cents >= 0),
    discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents >= 0),
    accepted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quote_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    clinical_record_id INTEGER,
    service_id INTEGER,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
    total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
    FOREIGN KEY (clinical_record_id) REFERENCES clinical_records(id) ON DELETE SET NULL,
    FOREIGN KEY (service_id) REFERENCES clinical_services_catalog(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    quote_id INTEGER,
    invoice_number INTEGER NOT NULL,
    invoice_year INTEGER NOT NULL,
    issued_at TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
    stamp_duty_paid INTEGER NOT NULL DEFAULT 0 CHECK(stamp_duty_paid IN (0, 1)),
    health_system_status TEXT NOT NULL DEFAULT 'pending' CHECK(health_system_status IN ('pending', 'sent', 'error')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(invoice_number, invoice_year),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    quote_line_id INTEGER,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
    total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (quote_line_id) REFERENCES quote_lines(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('sumup_pos', 'sumup_link', 'cash', 'bank_transfer')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    sumup_transaction_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'failed')),
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_type TEXT NOT NULL CHECK(integration_type IN ('sumup', 'google_calendar', 'rx_driver')),
    label TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    secret_ref TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(integration_type, label)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    last_error TEXT,
    run_after TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    device_id INTEGER,
    patient_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES authorized_devices(id) ON DELETE SET NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    sha256_hex TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_patients_last_first ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_tax_code ON patients(tax_code);
CREATE INDEX IF NOT EXISTS idx_appointments_starts_at ON appointments(starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_chair_time ON appointments(chair_number, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_records_patient_created ON clinical_records(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_clinical_records_tooth ON clinical_records(patient_id, tooth_number);
CREATE INDEX IF NOT EXISTS idx_clinical_records_quote_ready ON clinical_records(ready_for_quote, status);
CREATE INDEX IF NOT EXISTS idx_clinical_tooth_statuses_patient ON clinical_tooth_statuses(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_assets_patient ON rx_assets(patient_id);
CREATE INDEX IF NOT EXISTS idx_quotes_patient ON quotes(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_year_number ON invoices(invoice_year, invoice_number);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_patient_created ON audit_log(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_run_after ON sync_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn migrations_are_idempotent_and_patient_repository_round_trips() {
        let path = test_database_path();

        let db =
            Database::open(path.clone(), EncryptionKey::for_tests()).expect("open encrypted db");
        let status = db.status().expect("database status");
        assert!(status.open);
        assert!(status.encrypted);
        assert!(status.foreign_keys_enabled);
        assert_eq!(status.schema_version, CURRENT_SCHEMA_VERSION);

        let patient_id = db
            .insert_patient(&NewPatient {
                first_name: "Ada",
                last_name: "Lovelace",
                tax_code: "RSSMRA85M01H501Q",
                date_of_birth: "1815-12-10",
                phone: None,
                email: Some("ada@example.test"),
                address: None,
            })
            .expect("insert patient");

        let patient = db
            .get_patient(patient_id)
            .expect("get patient")
            .expect("patient exists");
        assert_eq!(patient.tax_code, "RSSMRA85M01H501Q");
        drop(db);

        let reopened =
            Database::open(path, EncryptionKey::for_tests()).expect("reopen encrypted db");
        let reopened_status = reopened.status().expect("reopened status");
        assert_eq!(reopened_status.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(reopened
            .get_patient(patient_id)
            .expect("get patient after reopen")
            .is_some());
    }

    #[test]
    fn admin_bootstrap_permissions_and_device_lifecycle_work() {
        let db = Database::open(test_database_path(), EncryptionKey::for_tests())
            .expect("open encrypted db");

        assert!(
            db.bootstrap_status()
                .expect("bootstrap status")
                .needs_first_admin
        );

        let admin = db
            .create_first_admin("admin", "change-me-now", Some("admin@example.test"))
            .expect("create first admin");
        assert_eq!(admin.role, Role::Admin);
        assert!(
            !db.bootstrap_status()
                .expect("bootstrap status after admin")
                .needs_first_admin
        );
        assert!(matches!(
            db.create_first_admin("second", "change-me-now", None),
            Err(DbError::BootstrapAlreadyCompleted)
        ));

        let logged_in = db.login("admin", "change-me-now").expect("login admin");
        assert_eq!(logged_in.id, admin.id);
        let session = db.create_session(logged_in.id).expect("create session");
        assert_eq!(
            db.user_for_session(&session.session_token)
                .expect("session user")
                .id,
            admin.id
        );
        assert!(matches!(
            db.user_for_session("not-a-real-session"),
            Err(DbError::Forbidden)
        ));
        assert!(matches!(
            db.login("admin", "wrong-password"),
            Err(DbError::InvalidCredentials)
        ));

        let aso = db
            .create_user(
                admin.id,
                &CreateUserInput {
                    username: "aso",
                    password: Some("aso-password"),
                    google_email: Some("aso@example.test"),
                    role: Role::Aso,
                },
            )
            .expect("create aso");
        assert_eq!(aso.role, Role::Aso);
        assert!(matches!(db.assert_admin(aso.id), Err(DbError::Forbidden)));

        let google = db
            .add_authorized_google_account(admin.id, "doctor@example.test", Role::Odontoiatra)
            .expect("authorize google account");
        assert_eq!(google.role, Role::Odontoiatra);

        let authorization = db
            .authorize_device(
                admin.id,
                Some(aso.id),
                "Tablet sala 1",
                Some("192.168.1.0/24"),
                None,
            )
            .expect("authorize device");
        assert!(authorization.token_once.len() > 32);
        assert!(authorization.device.revoked_at.is_none());

        let revoked = db
            .revoke_device(admin.id, authorization.device.id)
            .expect("revoke device");
        assert!(revoked.revoked_at.is_some());

        let audit_count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
            .expect("audit count");
        assert!(audit_count >= 7);
    }

    #[test]
    fn patient_crud_audit_and_tax_code_validation_work() {
        let db = Database::open(test_database_path(), EncryptionKey::for_tests())
            .expect("open encrypted db");
        let admin = db
            .create_first_admin("admin", "change-me-now", None)
            .expect("create first admin");

        assert!(validate_tax_code("RSSMRA85M01H501Q"));
        assert!(validate_tax_code("rssmra85m01h501q"));
        assert!(!validate_tax_code("RSSMRA85M01H501Z"));

        let patient = db
            .create_patient(
                admin.id,
                &NewPatient {
                    first_name: "Mario",
                    last_name: "Rossi",
                    tax_code: "rssmra85m01h501q",
                    date_of_birth: "1985-08-01",
                    phone: Some("+39 060000000"),
                    email: Some("mario.rossi@example.test"),
                    address: Some("Via Roma 1"),
                },
            )
            .expect("create patient");
        assert_eq!(patient.tax_code, "RSSMRA85M01H501Q");

        let opened = db
            .open_patient_record(admin.id, patient.id)
            .expect("open patient record");
        assert_eq!(opened.id, patient.id);

        let updated = db
            .update_patient(
                admin.id,
                patient.id,
                &NewPatient {
                    first_name: "Mario",
                    last_name: "Rossi",
                    tax_code: "RSSMRA85M01H501Q",
                    date_of_birth: "1985-08-01",
                    phone: Some("+39 061111111"),
                    email: Some("mario.rossi@example.test"),
                    address: Some("Via Milano 2"),
                },
            )
            .expect("update patient");
        assert_eq!(updated.phone.as_deref(), Some("+39 061111111"));

        let timeline = db
            .patient_timeline(admin.id, patient.id)
            .expect("patient timeline");
        assert!(timeline
            .iter()
            .any(|event| event.action == "PATIENT_RECORD_VIEW"));

        let audit_patient_id: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE patient_id = ?1 AND action = 'PATIENT_RECORD_VIEW'",
                [patient.id],
                |row| row.get(0),
            )
            .expect("view audit count");
        assert_eq!(audit_patient_id, 1);

        let deleted = db
            .delete_patient(admin.id, patient.id)
            .expect("soft delete patient");
        assert_eq!(deleted.id, patient.id);
        assert!(db
            .get_patient(patient.id)
            .expect("deleted patient lookup")
            .is_none());
    }

    #[test]
    fn odontogram_diary_catalog_and_audit_work() {
        let db = Database::open(test_database_path(), EncryptionKey::for_tests())
            .expect("open encrypted db");
        let admin = db
            .create_first_admin("admin", "change-me-now", None)
            .expect("create first admin");
        let patient = db
            .create_patient(
                admin.id,
                &NewPatient {
                    first_name: "Giulia",
                    last_name: "Bianchi",
                    tax_code: "BNCLGU85T41H501W",
                    date_of_birth: "1985-12-01",
                    phone: None,
                    email: None,
                    address: None,
                },
            )
            .expect("create patient");

        db.open_clinical_view(admin.id, patient.id)
            .expect("audit clinical view");
        let services = db
            .list_clinical_services(admin.id)
            .expect("clinical services");
        assert!(services.iter().any(|service| service.code == "OTT-001"));

        let tooth = db
            .set_tooth_status(admin.id, patient.id, 16, "pathology")
            .expect("set tooth status");
        assert_eq!(tooth.state, "pathology");
        let granular_tooth = db
            .set_tooth_status(admin.id, patient.id, 11, "caries")
            .expect("set granular tooth status");
        assert_eq!(granular_tooth.state, "caries");
        assert!(matches!(
            db.set_tooth_status(admin.id, patient.id, 19, "pathology"),
            Err(DbError::InvalidToothNumber)
        ));

        let service = services
            .iter()
            .find(|service| service.code == "OTT-001")
            .expect("filling service");
        let record = db
            .create_clinical_record(
                admin.id,
                &NewClinicalRecord {
                    patient_id: patient.id,
                    service_id: Some(service.id),
                    tooth_number: Some(16),
                    tooth_surface: Some("occlusale"),
                    pathology_description: Some("Carie primaria"),
                    status: "diagnosed",
                    ready_for_quote: true,
                    notes: Some("Da valutare in preventivo"),
                },
            )
            .expect("create clinical record");
        assert_eq!(record.tooth_number, Some(16));
        assert!(record.ready_for_quote);

        let records = db
            .list_clinical_records(
                admin.id,
                patient.id,
                &ClinicalRecordFilters {
                    date_from: None,
                    date_to: None,
                    tooth_number: Some(16),
                    operator_user_id: Some(admin.id),
                },
            )
            .expect("clinical diary");
        assert_eq!(records.len(), 1);

        let flagged = db
            .mark_clinical_record_ready_for_quote(admin.id, record.id, false)
            .expect("unmark quote flow");
        assert!(!flagged.ready_for_quote);

        let audit_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE patient_id = ?1 AND action = 'CLINICAL_VIEW_OPENED'",
                [patient.id],
                |row| row.get(0),
            )
            .expect("clinical view audit count");
        assert_eq!(audit_count, 1);
    }

    #[test]
    fn appointments_block_same_chair_overlap_and_enqueue_google_sync() {
        let db = Database::open(test_database_path(), EncryptionKey::for_tests())
            .expect("open encrypted db");
        let admin = db
            .create_first_admin("admin", "change-me-now", None)
            .expect("create first admin");
        db.update_studio_settings(
            admin.id,
            &StudioSettingsUpdate {
                clinic_name: Some("Studio VeloDent"),
                logo_relative_path: None,
                chair_count: 2,
                data_directory: None,
                holiday_periods_json: "[]",
            },
        )
        .expect("set chairs");
        let patient = db
            .create_patient(
                admin.id,
                &NewPatient {
                    first_name: "Luca",
                    last_name: "Verdi",
                    tax_code: "RSSMRA85M01H501Q",
                    date_of_birth: "1985-12-01",
                    phone: None,
                    email: None,
                    address: None,
                },
            )
            .expect("create patient");

        let first = db
            .create_appointment(
                admin.id,
                &AppointmentInput {
                    patient_id: Some(patient.id),
                    chair_number: 1,
                    title: "Pulizia",
                    starts_at: "2026-06-20T09:00:00+02:00",
                    ends_at: "2026-06-20T10:00:00+02:00",
                    status: "booked",
                    color_tag: Some("powder_blue"),
                    notes: Some("Nota interna non sincronizzata"),
                },
            )
            .expect("create first appointment");
        assert_eq!(first.chair_number, 1);

        assert!(matches!(
            db.create_appointment(
                admin.id,
                &AppointmentInput {
                    patient_id: Some(patient.id),
                    chair_number: 1,
                    title: "Otturazione",
                    starts_at: "2026-06-20T09:30:00+02:00",
                    ends_at: "2026-06-20T10:30:00+02:00",
                    status: "booked",
                    color_tag: None,
                    notes: None,
                },
            ),
            Err(DbError::AppointmentConflict)
        ));

        let second_chair = db
            .create_appointment(
                admin.id,
                &AppointmentInput {
                    patient_id: Some(patient.id),
                    chair_number: 2,
                    title: "Controllo",
                    starts_at: "2026-06-20T09:30:00+02:00",
                    ends_at: "2026-06-20T10:30:00+02:00",
                    status: "arrived",
                    color_tag: Some("glaucous"),
                    notes: None,
                },
            )
            .expect("same time on chair two");
        assert_eq!(second_chair.chair_number, 2);

        assert!(matches!(
            db.move_appointment(
                admin.id,
                second_chair.id,
                "2026-06-20T09:15:00+02:00",
                "2026-06-20T09:45:00+02:00",
                1,
            ),
            Err(DbError::AppointmentConflict)
        ));

        let moved = db
            .move_appointment(
                admin.id,
                second_chair.id,
                "2026-06-20T10:00:00+02:00",
                "2026-06-20T10:30:00+02:00",
                1,
            )
            .expect("move after first appointment");
        assert_eq!(moved.chair_number, 1);

        let queued_jobs: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sync_jobs WHERE integration_type = 'google_calendar' AND entity_type = 'appointment' AND status = 'queued'",
                [],
                |row| row.get(0),
            )
            .expect("sync jobs count");
        assert_eq!(queued_jobs, 3);

        let audit_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE patient_id = ?1 AND entity_type = 'appointments'",
                [patient.id],
                |row| row.get(0),
            )
            .expect("appointment audit count");
        assert_eq!(audit_count, 3);
    }

    fn test_database_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();

        env::temp_dir().join(format!("velodent-test-{suffix}.sqlite"))
    }
}
