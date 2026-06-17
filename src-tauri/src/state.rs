use crate::db::{Database, DbError};
use std::sync::{Mutex, MutexGuard};

pub struct AppState {
    database: Mutex<Database>,
}

impl AppState {
    pub fn initialize() -> Result<Self, DbError> {
        Ok(Self {
            database: Mutex::new(Database::open_default()?),
        })
    }

    pub fn database(&self) -> Result<MutexGuard<'_, Database>, String> {
        self.database
            .lock()
            .map_err(|_| "database lock poisoned".to_owned())
    }
}

