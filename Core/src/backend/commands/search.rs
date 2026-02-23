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
    let target_class_address = if object_address.to_lowercase().starts_with("0x") { usize::from_str_radix(object_address.trim_start_matches("0x").trim_start_matches("0X"), 16).map_err(|_| "Invalid address format")? } else { object_address.parse::<usize>().map_err(|_| "Invalid address format")? };

    println!("[search_object_instances] Searching for instances of class at address: 0x{:X}", target_class_address);

    let obj_mgr = Arc::clone(&state.object_manager);
    let proc_clone = {
        let process_lock = state.process.lock().map_err(|_| "Lock failed")?;
        process_lock.as_ref().ok_or("Process not attached")?.clone()
    };

    let results = tauri::async_runtime::spawn_blocking(move || {
        let mut local_results = Vec::new();
        // We only care about objects that are actual instances (have a class_ptr),
        // not classes themselves or properties.
        for entry in obj_mgr.cache_by_address.iter() {
            let obj = entry.value();

            // Fast fail: if it doesn't even have a class_ptr, it's not an instance
            if obj.class_ptr <= 0x10000 {
                continue;
            }

            let mut current_class_ptr = obj.class_ptr;
            let mut safety = 0;
            let mut is_match = false;

            // Travel up the inheritance tree (SuperStruct) to see if it inherits from target_class_address
            while current_class_ptr > 0x10000 && safety < 50 {
                if current_class_ptr == target_class_address {
                    is_match = true;
                    break;
                }

                // Read SuperStruct pointer (offset 0x40 in UE)
                current_class_ptr = proc_clone.memory.try_read_pointer(current_class_ptr.wrapping_add(0x40)).unwrap_or(0);
                safety += 1;
            }

            if is_match {
                local_results.push(InstanceSearchResult { instance_address: format!("0x{:X}", obj.address), object_name: obj.name.clone() });
            }
        }
        local_results
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    println!("[search_object_instances] Found {} instances in {:?}", results.len(), start_time.elapsed());
    Ok(results)
}

#[tauri::command]
pub async fn search_object_references(state: State<'_, AppState>, address_str: String, search_mode: String) -> Result<Vec<GlobalSearchResult>, String> {
    let target_address = if address_str.to_lowercase().starts_with("0x") { usize::from_str_radix(address_str.trim_start_matches("0x").trim_start_matches("0X"), 16).unwrap_or(0) } else { address_str.parse::<usize>().unwrap_or(0) };

    if target_address == 0 {
        return Err("Invalid or empty address provided".to_string());
    }

    let obj_mgr = Arc::clone(&state.object_manager);
    let process = state.process.lock().unwrap().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let limit = 500; // Limit results for performance
        let offsets = crate::backend::unreal::offsets::UEOffset::default();

        for entry in obj_mgr.cache_by_address.iter() {
            if results.len() >= limit {
                break;
            }
            let obj = entry.value();

            let mut matches = false;
            let matched_member_name: Option<String> = None;

            if search_mode == "Inheritance" {
                // Check if this object is an instance of the target class/struct
                if obj.class_ptr == target_address {
                    matches = true;
                } else if let Some(proc) = &process {
                    // Check if this object structurally inherits from the target (subclasses)
                    let type_lower = obj.type_name.to_lowercase();
                    if type_lower.contains("class") || type_lower.contains("struct") {
                        let mut super_addr = proc.memory.try_read_pointer(obj.address.wrapping_add(offsets.super_struct)).unwrap_or(0);
                        let mut safety = 0;
                        while super_addr > 0x10000 && safety < 20 {
                            safety += 1;
                            if super_addr == target_address {
                                matches = true;
                                break;
                            }
                            super_addr = proc.memory.try_read_pointer(super_addr.wrapping_add(offsets.super_struct)).unwrap_or(0);
                        }
                    }
                }
            } else if search_mode == "Member" {
                // The user wants to find objects that *contain* a property/member of the target type.
                // We iterate over all classes/structs and check their properties' sub-types.
                if let Some(proc) = &process {
                    let type_lower = obj.type_name.to_lowercase();
                    if type_lower.contains("class") || type_lower.contains("struct") {
                        let mut child_addr = proc.memory.try_read_pointer(obj.address.wrapping_add(offsets.member)).unwrap_or(0);
                        let mut safety = 0;
                        while child_addr > 0x10000 && safety < 2000 {
                            safety += 1;

                            // Check if this property points to our target_address
                            let prop_0 = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.property)).unwrap_or(0);
                            let prop_8 = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.property + 8)).unwrap_or(0);
                            let type_obj = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.type_object)).unwrap_or(0);

                            if prop_0 == target_address || prop_8 == target_address || type_obj == target_address {
                                matches = true;
                                break;
                            }

                            child_addr = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.next_member)).unwrap_or(0);
                        }
                    }
                }
            }

            if matches {
                let pkg_name = extract_package_name(&obj.full_name);
                results.push(GlobalSearchResult { package_name: pkg_name, object_name: obj.name.clone(), type_name: obj.type_name.clone(), address: obj.address, member_name: matched_member_name });
            }
        }

        // Sort results: 1. Type (Class -> Struct -> Enum -> Function)  2. Object Name
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

#[tauri::command]
pub async fn get_object_address_by_id(state: State<'_, AppState>, object_id: String) -> Result<Option<String>, String> {
    let id_num = object_id.parse::<i32>().map_err(|_| "Invalid object ID format")?;

    let obj_mgr = &state.object_manager;
    println!("[get_object_address_by_id] Querying ID: {}. Cache size: {}", id_num, obj_mgr.cache_by_id.len());

    if let Some(addr_ref) = obj_mgr.cache_by_id.get(&id_num) {
        println!("[get_object_address_by_id] Found ID {} -> Address 0x{:X}", id_num, *addr_ref);
        return Ok(Some(format!("0x{:X}", *addr_ref)));
    } else {
        println!("[get_object_address_by_id] ID {} NOT FOUND in cache_by_id!", id_num);
        if let Some(first) = obj_mgr.cache_by_id.iter().next() {
            println!("[get_object_address_by_id] Note: A sample entry in cache_by_id is key: {}", first.key());
        }
    }

    Ok(None)
}
