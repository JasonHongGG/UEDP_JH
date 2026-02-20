pub mod backend;

use backend::commands::get_handlers;
use backend::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(get_handlers())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
