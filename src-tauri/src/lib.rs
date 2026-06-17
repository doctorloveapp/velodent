mod agenda;
mod audit;
mod auth;
mod billing;
mod clinical;
mod db;
mod files;
mod health;
mod integrations;
mod patients;
mod server;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![health::health_check])
        .run(tauri::generate_context!())
        .expect("failed to run VeloDent");
}

