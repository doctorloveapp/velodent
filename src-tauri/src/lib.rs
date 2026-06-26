mod agenda;
mod audit;
mod auth;
mod billing;
mod clinical;
mod commands;
mod db;
mod dicom_meta;
mod files;
mod health;
mod integrations;
mod license;
mod patients;
mod rx_acquisition;
mod server;
mod state;
mod ts_cns;
#[cfg(feature = "mobile-tunnel")]
mod tunnel;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            integrations::google::load_dotenv();
            app.manage(state::AppState::initialize()?);
            server::lan::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health::health_check,
            commands::license_status,
            commands::activate_license,
            commands::database_status,
            commands::upsert_test_patient,
            commands::search_patients,
            commands::ensure_development_patient,
            commands::bootstrap_status,
            commands::create_first_admin,
            commands::login,
            commands::google_login_authorization_url,
            commands::exchange_google_login_code,
            commands::start_google_login,
            commands::create_user,
            commands::change_admin_password,
            commands::list_users,
            commands::add_authorized_google_account,
            commands::list_authorized_google_accounts,
            commands::authorize_device,
            commands::revoke_device,
            commands::list_devices,
            commands::get_pairing_code,
            commands::get_studio_settings,
            commands::update_studio_settings,
            commands::pick_studio_logo_path,
            commands::google_oauth_status,
            commands::google_calendar_sync_status,
            commands::google_calendar_authorization_url,
            commands::exchange_google_oauth_code,
            commands::list_google_calendar_accounts,
            commands::remove_google_account,
            commands::start_google_calendar_account_link,
            commands::process_google_calendar_sync,
            commands::get_chair_config,
            commands::list_agenda_blocks,
            commands::create_agenda_block,
            commands::delete_agenda_block,
            commands::list_appointments,
            commands::create_appointment,
            commands::move_appointment,
            commands::update_appointment_status,
            commands::delete_appointment,
            commands::validate_tax_code,
            commands::read_ts_cns,
            commands::create_patient,
            commands::update_patient,
            commands::delete_patient,
            commands::open_patient_record,
            commands::patient_timeline,
            commands::list_clinical_services,
            commands::list_clinical_services_catalog,
            commands::update_clinical_service_price,
            commands::upsert_clinical_service,
            commands::reorder_clinical_service,
            commands::list_quotes,
            commands::create_quote_from_diagnosis,
            commands::add_quote_line,
            commands::update_quote_discount,
            commands::update_quote_status,
            commands::create_deposit_invoice,
            commands::create_invoice_from_quote,
            commands::list_invoices,
            commands::register_payment,
            commands::generate_quote_pdf,
            commands::generate_invoice_pdf,
            commands::start_sumup_payment,
            commands::open_clinical_view,
            commands::get_tooth_statuses,
            commands::set_tooth_status,
            commands::create_clinical_record,
            commands::list_clinical_records,
            commands::mark_clinical_record_ready_for_quote,
            commands::delete_clinical_record,
            commands::calculate_bridge_units,
            commands::import_rx_file,
            commands::pick_rx_file_and_import,
            commands::pick_rx_folder_and_import,
            commands::mock_acquire_rx,
            commands::list_rx_assets,
            commands::rx_asset_data_url,
            commands::delete_rx_asset
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VeloDent");
}
