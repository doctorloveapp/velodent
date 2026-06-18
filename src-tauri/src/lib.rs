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
            commands::upsert_test_patient,
            commands::search_patients,
            commands::ensure_development_patient,
            commands::bootstrap_status,
            commands::create_first_admin,
            commands::login,
            commands::create_user,
            commands::list_users,
            commands::add_authorized_google_account,
            commands::list_authorized_google_accounts,
            commands::authorize_device,
            commands::revoke_device,
            commands::list_devices,
            commands::get_studio_settings,
            commands::update_studio_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VeloDent");
}
