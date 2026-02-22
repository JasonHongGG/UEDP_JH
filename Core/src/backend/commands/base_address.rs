use crate::backend::state::AppState;
use crate::backend::unreal::dumper::BaseAddressDumper;
use tauri::State;

#[tauri::command]
pub fn get_fname_pool_address(state: State<'_, AppState>) -> Result<usize, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        let addr = BaseAddressDumper::get_fname_pool(process)?;
        state.base_addresses.lock().unwrap().fname_pool = Some(addr);
        Ok(addr)
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn get_guobject_array_address(state: State<'_, AppState>) -> Result<usize, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        let (addr, element_size) = BaseAddressDumper::get_guobject_array_with_element_size(process)?;
        let mut ba = state.base_addresses.lock().unwrap();
        ba.guobject_array = Some(addr);
        ba.guobject_element_size = Some(element_size);
        Ok(addr)
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn get_gworld_address(state: State<'_, AppState>) -> Result<usize, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        let addr = BaseAddressDumper::get_gworld(process)?;
        state.base_addresses.lock().unwrap().gworld = Some(addr);
        Ok(addr)
    } else {
        Err("No process attached".to_string())
    }
}

#[tauri::command]
pub fn show_base_address(state: State<'_, AppState>) -> Result<String, String> {
    let process_state = state.process.lock().unwrap();
    if let Some(process) = process_state.as_ref() {
        let mut result_chunks = Vec::new();

        let fname_addr = BaseAddressDumper::get_fname_pool(process).map_err(|e| format!("Failed to get FNamePool: {}", e))?;
        result_chunks.push(format!("[ FNamePool ] 0x{:X}", fname_addr));

        let (guobj_addr, element_size) = BaseAddressDumper::get_guobject_array_with_element_size(process).map_err(|e| format!("Failed to get GUObjectArray: {}", e))?;
        result_chunks.push(format!("[ GUObject  ] 0x{:X}", guobj_addr));

        let gworld_addr = BaseAddressDumper::get_gworld(process).map_err(|e| format!("Failed to get GWorld: {}\n", e))?;
        result_chunks.push(format!("[ GWorld    ] 0x{:X}", gworld_addr));

        // Cache all resolved addresses into state
        {
            let mut ba = state.base_addresses.lock().unwrap();
            ba.fname_pool = Some(fname_addr);
            ba.guobject_array = Some(guobj_addr);
            ba.guobject_element_size = Some(element_size);
            ba.gworld = Some(gworld_addr);
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
