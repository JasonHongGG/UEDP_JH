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

#[tauri::command]
pub fn get_ue_version(state: State<'_, AppState>) -> Result<String, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        match process.get_ue_version() {
            Ok(version) => {
                println!("\n====== UE Version ======");
                println!("[ UE Version ] {}", version);
                println!("========================\n");
                Ok(version)
            }
            Err(e) => {
                println!("\n====== UE Version ======");
                println!("Failed to get UE Version: {}", e);
                println!("========================\n");
                Err(e)
            }
        }
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn parse_fname_pool(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        // Resolve the base address first
        let base_address = BaseAddressDumper::get_fname_pool(process)?;
        // Create the parser
        let pool = crate::backend::unreal::name_pool::FNamePool::new(base_address);
        // Call the counting logic
        match pool.parse_pool(process, &app_handle) {
            Ok((valid_blocks, valid_names)) => {
                println!("\n====== FNamePool Parsing ======");
                println!("[ FNamePool Quantity ] {}", valid_blocks);
                println!("[ FNamePool Valid Names ] {}", valid_names);
                println!("===============================\n");
                Ok(valid_blocks)
            }
            Err(e) => {
                println!("\n====== FNamePool Parsing ======");
                println!("Failed to parse FNamePool: {}", e);
                println!("===============================\n");
                Err(e)
            }
        }
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn parse_guobject_array(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        // Resolve base addresses
        let fname_pool_addr = BaseAddressDumper::get_fname_pool(process)?;
        let guobject_addr = BaseAddressDumper::get_guobject_array(process)?;

        // Create FNamePool (with DashMap cache for name lookup)
        let name_pool = crate::backend::unreal::name_pool::FNamePool::new(fname_pool_addr);

        // Create GUObjectArray parser
        let obj_array = crate::backend::unreal::object_array::GUObjectArray::new(guobject_addr);

        // Use default offsets (will be replaced with AutoConfig later)
        let offsets = crate::backend::unreal::offsets::UEOffset::default();

        match obj_array.parse_array(process, &name_pool, &offsets, &app_handle) {
            Ok(count) => {
                println!("\n====== GUObjectArray Parsing ======");
                println!("[ GUObjectArray Total Objects ] {}", count);
                println!("===================================\n");
                Ok(count)
            }
            Err(e) => {
                println!("\n====== GUObjectArray Parsing ======");
                println!("Failed to parse GUObjectArray: {}", e);
                println!("===================================\n");
                Err(e)
            }
        }
    } else {
        Err("No process attached".to_string())
    }
}

pub fn get_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![fetch_system_processes, attach_to_process, get_ue_version, get_fname_pool_address, parse_fname_pool, parse_guobject_array, get_guobject_array_address, get_gworld_address, show_base_address,]
}
