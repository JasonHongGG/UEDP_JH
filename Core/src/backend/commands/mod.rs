use crate::backend::os::process::{Process, ProcessInfo};
use crate::backend::state::AppState;
use crate::backend::unreal::dumper::BaseAddressDumper;
use std::sync::Arc;
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
pub async fn parse_fname_pool(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    // Safely extract owned data from state before handing off to spawn_blocking
    let process = state.process.lock().unwrap().clone().ok_or_else(|| "No process attached".to_string())?;
    let base_address = BaseAddressDumper::get_fname_pool(&process)?;

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
    // Safely extract owned/Arc data from state before handing off to spawn_blocking
    let process = state.process.lock().unwrap().clone().ok_or_else(|| "No process attached".to_string())?;
    let fname_pool_addr = BaseAddressDumper::get_fname_pool(&process)?;
    let (guobject_addr, element_size) = BaseAddressDumper::get_guobject_array_with_element_size(&process)?;

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

#[derive(serde::Serialize)]
pub struct PackageInfo {
    pub name: String,
    pub object_count: usize,
}

fn extract_package_name(input: &str) -> String {
    let first_slash = match input.find('/') {
        Some(idx) => idx,
        None => return String::new(),
    };

    let second_slash = match input[first_slash + 1..].find('/') {
        Some(idx) => first_slash + 1 + idx,
        None => return String::new(),
    };

    if let Some(idx) = input[second_slash + 1..].find('/') {
        let third_slash = second_slash + 1 + idx;
        return input[first_slash..third_slash].to_string();
    }

    if let Some(idx) = input[second_slash + 1..].find('.') {
        let dot_pos = second_slash + 1 + idx;
        return input[first_slash..dot_pos].to_string();
    }

    if let Some(idx) = input[second_slash + 1..].find(':') {
        let colon_pos = second_slash + 1 + idx;
        return input[first_slash..colon_pos].to_string();
    }

    input[first_slash..].to_string()
}

#[tauri::command]
pub fn get_packages(state: State<'_, AppState>) -> Result<Vec<PackageInfo>, String> {
    let obj_mgr = &state.object_manager;
    let mut package_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for entry in obj_mgr.cache_by_address.iter() {
        let obj = entry.value();
        let pkg_name = extract_package_name(&obj.full_name);

        // Match legacy C++ logic: Include native Scripts, Engine core, and root Game folder
        if !pkg_name.is_empty() && (pkg_name.starts_with("/Script/") || pkg_name.starts_with("/Engine/") || pkg_name.starts_with("/Game/")) {
            *package_counts.entry(pkg_name).or_insert(0) += 1;
        }
    }

    let mut packages: Vec<PackageInfo> = package_counts.into_iter().map(|(name, count)| PackageInfo { name, object_count: count }).collect();

    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

#[derive(serde::Serialize)]
pub struct ObjectSummary {
    pub address: usize,
    pub name: String,
    pub full_name: String,
    pub type_name: String,
}

#[tauri::command]
pub fn get_objects(state: State<'_, AppState>, package_name: String, category: String) -> Result<Vec<ObjectSummary>, String> {
    let obj_mgr = &state.object_manager;
    let mut results = Vec::new();

    for entry in obj_mgr.cache_by_address.iter() {
        let obj = entry.value();
        let pkg_name = extract_package_name(&obj.full_name);

        if pkg_name == package_name {
            let is_match = match category.as_str() {
                "Class" => obj.type_name.contains("Class") && !obj.type_name.contains("Function"),
                "Struct" => obj.type_name.contains("Struct") && !obj.type_name.contains("Function"),
                "Enum" => obj.type_name.contains("Enum"),
                "Function" => obj.type_name.contains("Function"),
                _ => false, // fallback
            };
            if is_match {
                results.push(ObjectSummary { address: obj.address, name: obj.name.clone(), full_name: obj.full_name.clone(), type_name: obj.type_name.clone() });
            }
        }
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}

#[derive(serde::Serialize, Clone)]
pub struct ObjectPropertyInfo {
    pub property_name: String,
    pub property_type: String,
    pub offset: String,          // hex string like "A8"
    pub sub_type: String,        // e.g. "< DashToData >" for StructProperty
    pub sub_type_address: usize, // address to jump to
}

#[derive(serde::Serialize, Clone)]
pub struct InheritanceItem {
    pub name: String,
    pub address: usize,
}

#[derive(serde::Serialize, Clone)]
pub struct EnumValueItem {
    pub name: String,
    pub value: i64,
}

#[derive(serde::Serialize, Clone)]
pub struct FunctionParamInfo {
    pub param_type: String,
    pub param_name: String,
    pub type_address: usize, // address to jump to if it's an object
}

#[derive(serde::Serialize, Clone)]
pub struct DetailedObjectInfo {
    pub address: usize,
    pub function_address: usize, // only for Function type
    pub function_offset: String, // hex offset for function
    pub name: String,
    pub full_name: String,
    pub type_name: String,
    pub inheritance: Vec<InheritanceItem>,
    pub properties: Vec<ObjectPropertyInfo>,
    pub enum_values: Vec<EnumValueItem>,
    pub enum_underlying_type: String,
    pub function_owner: String,
    pub function_owner_address: usize,
    pub function_return_type: String,
    pub function_return_address: usize,
    pub function_params: Vec<FunctionParamInfo>,
    pub prop_size: i32,
}

#[tauri::command]
pub fn get_object_details(state: State<'_, AppState>, address: usize) -> Result<DetailedObjectInfo, String> {
    let obj_mgr = &state.object_manager;
    let obj = obj_mgr.cache_by_address.get(&address).ok_or("Object not found")?.clone();

    let process_state = state.process.lock().unwrap();
    let process = process_state.as_ref().ok_or("No process attached")?;

    // Get the shared FNamePool from AppState (populated during parse)
    let name_pool = {
        let np_lock = state.name_pool.lock().unwrap();
        np_lock.as_ref().ok_or("FNamePool not yet parsed. Please parse GUObjectArray first.")?.clone()
    };
    let offsets = crate::backend::unreal::offsets::UEOffset::default();

    println!("[get_object_details] Starting for '{}' type='{}' addr=0x{:X}", obj.name, obj.type_name, address);

    let mut result = DetailedObjectInfo {
        address: obj.address,
        function_address: 0,
        function_offset: String::new(),
        name: obj.name.clone(),
        full_name: obj.full_name.clone(),
        type_name: obj.type_name.clone(),
        inheritance: vec![],
        properties: vec![],
        enum_values: vec![],
        enum_underlying_type: String::new(),
        function_owner: String::new(),
        function_owner_address: 0,
        function_return_type: String::new(),
        function_return_address: 0,
        function_params: vec![],
        prop_size: 0,
    };

    // ═══ Get Inheritance Chain (chase SuperStruct) ═══
    let mut super_addr = process.memory.try_read_pointer(address.wrapping_add(offsets.super_struct)).unwrap_or(0);
    while super_addr > 0x10000 {
        if let Some(super_obj) = obj_mgr.cache_by_address.get(&super_addr) {
            result.inheritance.push(InheritanceItem { name: super_obj.name.clone(), address: super_obj.address });
            super_addr = process.memory.try_read_pointer(super_addr.wrapping_add(offsets.super_struct)).unwrap_or(0);
        } else {
            break;
        }
    }
    result.inheritance.reverse(); // root first

    // ═══ Branch by type ═══
    let type_lower = obj.type_name.to_lowercase();

    if type_lower.contains("class") || type_lower.contains("struct") {
        // Read PropSize
        result.prop_size = process.memory.try_read::<i32>(address.wrapping_add(offsets.prop_size)).unwrap_or(0);

        // ═══ Walk children (ChildProperty chain) ═══
        let mut child_addr = process.memory.try_read_pointer(address.wrapping_add(offsets.member)).unwrap_or(0);
        println!("[get_object_details] '{}' type='{}' addr=0x{:X} member_offset=0x{:X} first_child=0x{:X}", obj.name, obj.type_name, address, offsets.member, child_addr);

        let mut safety = 0;
        while child_addr > 0x10000 && safety < 2000 {
            safety += 1;

            // Read this child's basic info
            let child_name_id = process.memory.try_read::<i32>(child_addr.wrapping_add(offsets.member_fname_index)).unwrap_or(0);
            let child_name = name_pool.get_name(process, child_name_id as u32).unwrap_or_default();

            // Read child type via member_type_offset chain
            let type_ptr = process.memory.try_read_pointer(child_addr.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
            let type_id = process.memory.try_read::<i32>(type_ptr.wrapping_add(offsets.member_type)).unwrap_or(0);
            let child_type = name_pool.get_name(process, type_id as u32).unwrap_or_default();

            // Read offset
            let child_offset = process.memory.try_read::<i32>(child_addr.wrapping_add(offsets.offset)).unwrap_or(0);

            println!("[get_object_details]   child[{}] addr=0x{:X} name='{}' type='{}' offset=0x{:X}", safety - 1, child_addr, child_name, child_type, child_offset);

            // Read sub-type for complex properties
            // Matches old C++ GetProperty: try Property_8 → Property_0 → TypeObject fallback
            let mut sub_type = String::new();
            let mut sub_type_address: usize = 0;

            let prop_0 = process.memory.try_read_pointer(child_addr.wrapping_add(offsets.property)).unwrap_or(0);
            let prop_8 = process.memory.try_read_pointer(child_addr.wrapping_add(offsets.property + 8)).unwrap_or(0);
            let type_obj = process.memory.try_read_pointer(child_addr.wrapping_add(offsets.type_object)).unwrap_or(0);

            if child_type.contains("StructProperty")
                || child_type.contains("ObjectProperty")
                || child_type.contains("ClassProperty")
                || child_type.contains("ArrayProperty")
                || child_type.contains("EnumProperty")
                || child_type.contains("ByteProperty")
                || child_type.contains("SoftClassProperty")
                || child_type.contains("SoftObjectProperty")
                || child_type.contains("SetProperty")
                || child_type.contains("InterfaceProperty")
            {
                // Fallback: Property_8 → Property_0 → TypeObject (matching old C++)
                let candidates = [prop_8, prop_0, type_obj];
                for &addr in &candidates {
                    if addr > 0x10000 {
                        if let Some(sub_obj) = obj_mgr.cache_by_address.get(&addr) {
                            sub_type = sub_obj.name.clone();
                            sub_type_address = sub_obj.address;
                            break;
                        } else {
                            // Try reading FName directly from the object
                            let sub_name_id = process.memory.try_read::<i32>(addr.wrapping_add(offsets.fname_index)).unwrap_or(0);
                            if let Ok(name) = name_pool.get_name(process, sub_name_id as u32) {
                                if !name.is_empty() {
                                    sub_type = name;
                                    sub_type_address = addr;
                                    break;
                                }
                            }
                        }
                    }
                }
            } else if child_type.contains("MapProperty") {
                // MapProperty: read both key and value sub-types
                let mut parts = vec![];
                // Try Property_0 for first sub-type, Property_8 for second
                for &addr in &[prop_0, prop_8] {
                    if addr > 0x10000 {
                        if let Some(sub_obj) = obj_mgr.cache_by_address.get(&addr) {
                            parts.push(sub_obj.name.clone());
                        } else {
                            let sub_name_id = process.memory.try_read::<i32>(addr.wrapping_add(offsets.fname_index)).unwrap_or(0);
                            if let Ok(name) = name_pool.get_name(process, sub_name_id as u32) {
                                parts.push(name);
                            }
                        }
                    }
                }
                sub_type = parts.join(", ");
            }

            if !child_name.is_empty() && !child_type.is_empty() {
                // For BoolProperty, append the BitMask to the offset (e.g. "F4:0")
                let offset_str = if child_type.contains("BoolProperty") {
                    let bitmask = process.memory.try_read::<u8>(child_addr.wrapping_add(offsets.bit_mask)).unwrap_or(0);
                    let bit_index = if bitmask > 0 { bitmask.trailing_zeros() } else { 0 };
                    format!("{:X}:{}", child_offset, bit_index)
                } else {
                    format!("{:X}", child_offset)
                };
                result.properties.push(ObjectPropertyInfo { property_name: child_name, property_type: child_type, offset: offset_str, sub_type, sub_type_address });
            }

            // Next child
            child_addr = process.memory.try_read_pointer(child_addr.wrapping_add(offsets.next_member)).unwrap_or(0);
        }

        println!("[get_object_details] Total properties found for '{}': {}", obj.name, result.properties.len());
    } else if type_lower.starts_with("enum") || type_lower == "userenum" {
        // ═══ Enum: read enum values ═══
        // Read underlying type
        let enum_type_addr = process.memory.try_read_pointer(address.wrapping_add(offsets.enum_type)).unwrap_or(0);
        if enum_type_addr > 0x10000 {
            let type_name_id = process.memory.try_read::<i32>(enum_type_addr.wrapping_add(offsets.fname_index)).unwrap_or(0);
            result.enum_underlying_type = name_pool.get_name(process, type_name_id as u32).unwrap_or("Byte".to_string());
        }

        // Read enum entries: list at enum_list offset, count at enum_size
        let list_ptr = process.memory.try_read_pointer(address.wrapping_add(offsets.enum_list)).unwrap_or(0);
        let list_count = process.memory.try_read::<i32>(address.wrapping_add(offsets.enum_size)).unwrap_or(0);

        if list_ptr > 0x10000 && list_count > 0 && list_count < 10000 {
            for i in 0..list_count as usize {
                let entry_addr = list_ptr.wrapping_add(i * offsets.enum_prop_mul);

                // Read name (FName pair)
                let name_id = process.memory.try_read::<i32>(entry_addr.wrapping_add(offsets.enum_prop_name)).unwrap_or(0);
                let enum_name = name_pool.get_name(process, name_id as u32).unwrap_or_default();

                // Read value
                let enum_value = process.memory.try_read::<i64>(entry_addr.wrapping_add(offsets.enum_prop_index)).unwrap_or(0);

                if !enum_name.is_empty() {
                    result.enum_values.push(EnumValueItem { name: enum_name, value: enum_value });
                }
            }
        }
    } else if type_lower.contains("function") {
        // ═══ Function: read address, owner, params ═══
        result.function_address = process.memory.try_read_pointer(address.wrapping_add(offsets.funct)).unwrap_or(0);
        if result.function_address > 0 {
            // Calculate offset relative to module base (rough estimate)
            result.function_offset = format!("0x{:X}", result.function_address);
        }

        // Function owner (Outer)
        if obj.outer > 0x10000 {
            if let Some(owner_obj) = obj_mgr.cache_by_address.get(&obj.outer) {
                result.function_owner = owner_obj.name.clone();
                result.function_owner_address = owner_obj.address;
            }
        }

        // Function parameters: walk the ChildProperty chain under this function
        let mut param_addr = process.memory.try_read_pointer(address.wrapping_add(offsets.funct_para)).unwrap_or(0);
        let mut safety = 0;
        while param_addr > 0x10000 && safety < 200 {
            safety += 1;

            let param_name_id = process.memory.try_read::<i32>(param_addr.wrapping_add(offsets.member_fname_index)).unwrap_or(0);
            let param_name = name_pool.get_name(process, param_name_id as u32).unwrap_or_default();

            let type_ptr = process.memory.try_read_pointer(param_addr.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
            let type_id = process.memory.try_read::<i32>(type_ptr.wrapping_add(offsets.member_type)).unwrap_or(0);
            let param_type = name_pool.get_name(process, type_id as u32).unwrap_or_default();

            // Check if param_type has a sub-type (object reference)
            let mut type_address: usize = 0;
            let prop_0 = process.memory.try_read_pointer(param_addr.wrapping_add(offsets.property)).unwrap_or(0);
            if prop_0 > 0x10000 {
                if let Some(sub_obj) = obj_mgr.cache_by_address.get(&prop_0) {
                    type_address = sub_obj.address;
                }
            }

            // "ReturnValue" is the return type
            if param_name == "ReturnValue" {
                result.function_return_type = param_type.clone();
                result.function_return_address = type_address;
            } else if !param_name.is_empty() && !param_type.is_empty() {
                result.function_params.push(FunctionParamInfo { param_type, param_name, type_address });
            }

            param_addr = process.memory.try_read_pointer(param_addr.wrapping_add(offsets.next_member)).unwrap_or(0);
        }
    }

    Ok(result)
}

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

pub fn get_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![fetch_system_processes, attach_to_process, get_ue_version, get_fname_pool_address, parse_fname_pool, parse_guobject_array, get_guobject_array_address, get_gworld_address, show_base_address, get_packages, get_objects, get_object_details, global_search]
}
