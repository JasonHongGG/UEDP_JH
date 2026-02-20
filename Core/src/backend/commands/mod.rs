use crate::backend::os::process::{Process, ProcessInfo};
use crate::backend::state::AppState;
use crate::backend::unreal::dumper::BaseAddressDumper;
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

#[tauri::command]
pub fn get_fname_pool_address(state: State<'_, AppState>) -> Result<usize, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        BaseAddressDumper::get_fname_pool(process)
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn get_guobject_array_address(state: State<'_, AppState>) -> Result<usize, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        BaseAddressDumper::get_guobject_array(process)
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn get_gworld_address(state: State<'_, AppState>) -> Result<usize, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        BaseAddressDumper::get_gworld(process)
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn show_base_address(state: State<'_, AppState>) -> Result<String, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        let mut result_chunks = Vec::new();

        match BaseAddressDumper::get_fname_pool(process) {
            Ok(addr) => result_chunks.push(format!("[ FNamePool ] 0x{:X}", addr)),
            Err(e) => return Err(format!("Failed to get FNamePool: {}", e)),
        }

        match BaseAddressDumper::get_guobject_array(process) {
            Ok(addr) => result_chunks.push(format!("[ GUObject  ] 0x{:X}", addr)),
            Err(e) => return Err(format!("Failed to get GUObjectArray: {}", e)),
        }

        match BaseAddressDumper::get_gworld(process) {
            Ok(addr) => result_chunks.push(format!("[ GWorld    ] 0x{:X}", addr)),
            Err(e) => return Err(format!("Failed to get GWorld: {}\n", e)),
        }

        let combined_output = result_chunks.join("\n");
        println!("\n====== Base Addresses ======");
        println!("{}", combined_output);
        println!("============================\n");

        Ok(combined_output)
    } else {
        Err("No process attached".to_string())
    }
}
