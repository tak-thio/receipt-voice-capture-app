mod commands;
mod models;
mod repositories;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::session::create_session,
            commands::session::load_session,
            commands::session::save_session,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::capture::save_capture_image,
            commands::export::export_csv
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
