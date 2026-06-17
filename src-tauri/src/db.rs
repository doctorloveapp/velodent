use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
};

const CURRENT_SCHEMA_VERSION: i64 = 1;
const DEFAULT_DEV_KEY: &str = "velodent-development-only-change-me";

#[derive(Debug)]
pub enum DbError {
    Io(String),
    Sql(String),
    InvalidEncryptionKey,
    MissingEncryptionKey,
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
            .query_row("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1", [], |row| {
                row.get(0)
            })
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

    pub fn insert_patient(&self, patient: &NewPatient<'_>) -> DbResult<i64> {
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
                patient.first_name,
                patient.last_name,
                patient.tax_code,
                patient.date_of_birth,
                patient.phone,
                patient.email,
                patient.address,
            ],
        )?;

        Ok(self.conn.last_insert_rowid())
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
                WHERE id = ?1
                "#,
                [id],
                patient_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }

    pub fn upsert_test_patient(&self) -> DbResult<Patient> {
        let tax_code = "TESTVELODENT0001";

        if let Some(existing) = self.find_patient_by_tax_code(tax_code)? {
            return Ok(existing);
        }

        let id = self.insert_patient(&NewPatient {
            first_name: "Test",
            last_name: "VeloDent",
            tax_code,
            date_of_birth: "1990-01-01",
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
                WHERE tax_code = ?1
                "#,
                [tax_code],
                patient_from_row,
            )
            .optional()
            .map_err(DbError::from)
    }
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
    conn.execute(
        r#"
        INSERT OR IGNORE INTO schema_migrations (version, name)
        VALUES (?1, ?2)
        "#,
        params![CURRENT_SCHEMA_VERSION, "initial_secure_schema"],
    )?;
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

        let db = Database::open(path.clone(), EncryptionKey::for_tests()).expect("open encrypted db");
        let status = db.status().expect("database status");
        assert!(status.open);
        assert!(status.encrypted);
        assert!(status.foreign_keys_enabled);
        assert_eq!(status.schema_version, CURRENT_SCHEMA_VERSION);

        let patient_id = db
            .insert_patient(&NewPatient {
                first_name: "Ada",
                last_name: "Lovelace",
                tax_code: "TESTADA00000001",
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
        assert_eq!(patient.tax_code, "TESTADA00000001");
        drop(db);

        let reopened = Database::open(path, EncryptionKey::for_tests()).expect("reopen encrypted db");
        let reopened_status = reopened.status().expect("reopened status");
        assert_eq!(reopened_status.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(reopened
            .get_patient(patient_id)
            .expect("get patient after reopen")
            .is_some());
    }

    fn test_database_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();

        env::temp_dir().join(format!("velodent-test-{suffix}.sqlite"))
    }
}
