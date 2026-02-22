use crate::backend::os::process::{Process, ProcessInfo};
use crate::backend::state::AppState;
use tauri::State;

#[tauri::command]
pub fn fetch_system_processes() -> Vec<ProcessInfo> {
    Process::get_processes()
}

#[tauri::command]
pub fn attach_to_process(state: State<'_, AppState>, pid: u32, name: String) -> Result<String, String> {
    println!("Attaching to process {} ({})", name, pid);
    Process::attach(&state, pid, &name)
}
