use crate::{
    db::{DatabaseStatus, Patient},
    state::AppState,
};
use tauri::State;

#[tauri::command]
pub fn database_status(state: State<'_, AppState>) -> Result<DatabaseStatus, String> {
    state.database()?.status().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_test_patient(state: State<'_, AppState>) -> Result<Patient, String> {
    state
        .database()?
        .upsert_test_patient()
        .map_err(|error| error.to_string())
}

