use crate::auth::{self, Role};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const CURRENT_SCHEMA_VERSION: i64 = 2;
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
    conn.execute(
        r#"
        INSERT OR IGNORE INTO schema_migrations (version, name)
        VALUES (?1, ?2)
        "#,
        params![CURRENT_SCHEMA_VERSION, "patient_soft_delete_and_audit_view"],
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

CREATE TABLE IF NOT EXISTS clinical_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    service_id INTEGER,
    tooth_number INTEGER CHECK(tooth_number IS NULL OR (tooth_number BETWEEN 11 AND 48)),
    tooth_surface TEXT,
    pathology_description TEXT,
    status TEXT NOT NULL DEFAULT 'diagnosed' CHECK(status IN ('diagnosed', 'in_quote', 'performed')),
    notes TEXT,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES clinical_services_catalog(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
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
CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_assets_patient ON rx_assets(patient_id);
CREATE INDEX IF NOT EXISTS idx_quotes_patient ON quotes(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_year_number ON invoices(invoice_year, invoice_number);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_patient_created ON audit_log(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_run_after ON sync_jobs(status, run_after);
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

    fn test_database_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();

        env::temp_dir().join(format!("velodent-test-{suffix}.sqlite"))
    }
}
