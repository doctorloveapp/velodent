mod agenda;
mod audit;
mod auth;
mod billing;
mod clinical;
mod commands;
mod db;
mod files;
mod health;
mod integrations;
mod patients;
mod server;
mod state;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(state::AppState::initialize()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health::health_check,
            commands::database_status,
            commands::upsert_test_patient
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VeloDent");
}
