pub mod backend;

use backend::commands::{attach_to_process, fetch_system_processes, get_fname_pool_address, get_guobject_array_address, get_gworld_address};
use backend::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![fetch_system_processes, attach_to_process, get_fname_pool_address, get_guobject_array_address, get_gworld_address])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
