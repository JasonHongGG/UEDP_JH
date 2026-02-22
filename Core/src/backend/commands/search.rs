use crate::backend::commands::package::extract_package_name;
use crate::backend::state::AppState;
use std::sync::Arc;
use tauri::State;

#[derive(serde::Serialize)]
pub struct GlobalSearchResult {
    pub package_name: String,
    pub object_name: String,
    pub type_name: String,
    pub address: usize,
    pub member_name: Option<String>,
}

#[tauri::command]
pub async fn global_search(state: State<'_, AppState>, query: String, search_mode: String) -> Result<Vec<GlobalSearchResult>, String> {
    let query_lower = query.to_lowercase();
    let obj_mgr = Arc::clone(&state.object_manager);

    // For Member search, we need process & name_pool
    let process = state.process.lock().unwrap().clone();
    let name_pool = {
        let np_lock = state.name_pool.lock().unwrap();
        np_lock.clone()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let limit = 500; // Limit results for performance
        let offsets = crate::backend::unreal::offsets::UEOffset::default();

        for entry in obj_mgr.cache_by_address.iter() {
            if results.len() >= limit {
                break;
            }
            let obj = entry.value();

            let pkg_name = extract_package_name(&obj.full_name);

            if search_mode == "Object" {
                let t_lower = obj.type_name.to_lowercase();
                let is_valid_type = t_lower.contains("class") || t_lower.contains("struct") || t_lower.contains("enum") || t_lower == "userenum" || t_lower.contains("function");

                if is_valid_type && obj.name.to_lowercase().contains(&query_lower) {
                    results.push(GlobalSearchResult { package_name: pkg_name, object_name: obj.name.clone(), type_name: obj.type_name.clone(), address: obj.address, member_name: None });
                }
            } else if search_mode == "Member" {
                let type_lower = obj.type_name.to_lowercase();
                if type_lower.contains("class") || type_lower.contains("struct") {
                    if let (Some(proc), Some(np)) = (&process, &name_pool) {
                        let mut child_addr = proc.memory.try_read_pointer(obj.address.wrapping_add(offsets.member)).unwrap_or(0);
                        let mut safety = 0;
                        while child_addr > 0x10000 && safety < 2000 {
                            safety += 1;
                            let child_name_id = proc.memory.try_read::<i32>(child_addr.wrapping_add(offsets.member_fname_index)).unwrap_or(0);
                            let child_name = np.get_name(proc, child_name_id as u32).unwrap_or_default();

                            if child_name.to_lowercase().contains(&query_lower) {
                                results.push(GlobalSearchResult { package_name: pkg_name.clone(), object_name: obj.name.clone(), type_name: obj.type_name.clone(), address: obj.address, member_name: Some(child_name) });
                                if results.len() >= limit {
                                    break;
                                }
                            }

                            child_addr = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.next_member)).unwrap_or(0);
                        }
                    }
                }
            }
        }

        // Sort results: 1. Type (Class -> Struct -> Enum -> Function)  2. Object Name  3. Package Name
        results.sort_by(|a, b| {
            let order = |type_name: &str| -> u8 {
                let t = type_name.to_lowercase();
                if t.contains("class") {
                    0
                } else if t.contains("struct") {
                    1
                } else if t.contains("enum") || t == "userenum" {
                    2
                } else if t.contains("function") {
                    3
                } else {
                    4
                }
            };

            let priority_a = order(&a.type_name);
            let priority_b = order(&b.type_name);

            priority_a.cmp(&priority_b).then_with(|| a.object_name.to_lowercase().cmp(&b.object_name.to_lowercase())).then_with(|| a.package_name.cmp(&b.package_name))
        });

        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct InstanceSearchResult {
    pub instance_address: String,
    pub object_name: String,
}

#[tauri::command]
pub async fn search_object_instances(state: State<'_, AppState>, object_address: String) -> Result<Vec<InstanceSearchResult>, String> {
    let start_time = std::time::Instant::now();
    let addr = u64::from_str_radix(object_address.trim_start_matches("0x"), 16).map_err(|_| "Invalid address format")?;
    let signature = addr.to_le_bytes().iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");

    let process_lock = state.process.lock().map_err(|_| "Lock failed")?;
    let proc = process_lock.as_ref().ok_or("Process not attached")?;

    // In Unreal, user memory usually doesn't exceed 0x7FFFFFFFFFFF
    let hits = crate::backend::os::scanner::Scanner::scan(&proc.memory, 0x0, 0x7FFFFFFFFFFF, &signature).map_err(|e| format!("Scan failed: {}", e))?;

    let mut results = Vec::new();
    let obj_mgr = &state.object_manager;

    let name_pool_lock = state.name_pool.lock().map_err(|_| "Name pool lock failed")?;
    let name_pool = name_pool_lock.as_ref().ok_or("Name pool not valid")?;

    let offsets = crate::backend::unreal::offsets::UEOffset::default();

    // Resolve hits into concrete instances
    for hit in hits {
        let instance_addr = hit.saturating_sub(0x10);

        // Dynamically parse the object instance instead of relying on class address cache
        if let Some(obj_data) = obj_mgr.try_save_object(instance_addr, proc, name_pool, &offsets, 0, 5) {
            if obj_data.name != "InvalidName" && obj_data.name != "None" {
                results.push(InstanceSearchResult { instance_address: format!("0x{:X}", instance_addr), object_name: obj_data.name });
            }
        }
    }

    println!("[search_object_instances] Found {} instances in {:?}", results.len(), start_time.elapsed());
    Ok(results)
}
