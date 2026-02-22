use crate::backend::state::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn parse_fname_pool(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    let process = state.process.lock().unwrap().clone().ok_or("No process attached")?;
    let base_address = state.base_addresses.lock().unwrap().fname_pool.ok_or("FNamePool address not resolved. Please call get_fname_pool_address first.")?;

    tauri::async_runtime::spawn_blocking(move || {
        let pool = crate::backend::unreal::name_pool::FNamePool::new(base_address);
        match pool.parse_pool(&process, &app_handle) {
            Ok((valid_blocks, valid_names)) => {
                println!("\n====== FNamePool Parsing ======");
                println!("[ FNamePool Quantity ] {}", valid_blocks);
                println!("[ FNamePool Valid Names ] {}", valid_names);
                println!("===============================\n");
                Ok(valid_blocks)
            }
            Err(e) => {
                println!("Failed to parse FNamePool: {}", e);
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn parse_guobject_array(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    let process = state.process.lock().unwrap().clone().ok_or("No process attached")?;
    let (fname_pool_addr, guobject_addr, element_size) = {
        let ba = state.base_addresses.lock().unwrap();
        let fname = ba.fname_pool.ok_or("FNamePool address not resolved. Please call get_fname_pool_address first.")?;
        let guobj = ba.guobject_array.ok_or("GUObjectArray address not resolved. Please call get_guobject_array_address first.")?;
        let size = ba.guobject_element_size.ok_or("GUObjectArray element size not resolved. Please call get_guobject_array_address first.")?;
        (fname, guobj, size)
    };

    let name_pool = Arc::new(crate::backend::unreal::name_pool::FNamePool::new(fname_pool_addr));
    {
        let mut np_lock = state.name_pool.lock().unwrap();
        *np_lock = Some(Arc::clone(&name_pool));
    }

    let obj_mgr = Arc::clone(&state.object_manager);
    obj_mgr.cache_by_address.clear();
    obj_mgr.cache_by_id.clear();
    obj_mgr.total_object_count.store(0, std::sync::atomic::Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        let obj_array = crate::backend::unreal::object_array::GUObjectArray::new(guobject_addr);
        let offsets = crate::backend::unreal::offsets::UEOffset::default();
        match obj_array.parse_array(&process, &name_pool, &offsets, element_size, &app_handle, &obj_mgr) {
            Ok(count) => {
                println!("\n====== GUObjectArray Parsing ======");
                println!("[ GUObjectArray Total Objects ] {}", count);
                println!("===================================\n");
                Ok(count)
            }
            Err(e) => {
                println!("Failed to parse GUObjectArray: {}", e);
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
