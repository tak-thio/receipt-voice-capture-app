mod commands;
mod models;
mod repositories;
mod services;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::audio::save_audio_clip,
            commands::session::create_session,
            commands::session::load_current_session,
            commands::session::load_latest_session,
            commands::session::load_session,
            commands::session::list_sessions,
            commands::session::save_session,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::capture::save_capture_image,
            commands::ocr::extract_ocr_from_image,
            commands::ocr::get_ocr_diagnostics,
            commands::stt::transcribe_audio,
            commands::stt::get_stt_diagnostics,
            commands::ai_formatter::format_receipt_text,
            commands::ai_formatter::get_ai_diagnostics,
            commands::export::export_csv
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
