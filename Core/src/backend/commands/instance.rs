use crate::backend::state::AppState;
use tauri::State;

#[derive(serde::Serialize)]
pub struct InspectorHierarchyNode {
    pub name: String,
    pub type_name: String,
    pub address: String, // Hex string
}

#[tauri::command]
pub async fn add_inspector(state: State<'_, AppState>, instance_address: String) -> Result<Vec<InspectorHierarchyNode>, String> {
    let inst_addr = usize::from_str_radix(instance_address.trim_start_matches("0x"), 16).map_err(|_| "Invalid address")?;

    let process_lock = state.process.lock().map_err(|_| "Lock failed")?;
    let proc = process_lock.as_ref().ok_or("Process not attached")?;
    let obj_mgr = &state.object_manager;

    let name_pool_lock = state.name_pool.lock().map_err(|_| "Name pool lock failed")?;
    let name_pool = name_pool_lock.as_ref().ok_or("Name pool not valid")?;
    let offsets = crate::backend::unreal::offsets::UEOffset::default();

    let mut hierarchy = Vec::new();

    // Read the ClassPrivate pointer from the Instance (Offset: 0x10)
    let mut current_class_addr = proc.memory.try_read_pointer(inst_addr.wrapping_add(0x10)).unwrap_or(0);

    let mut safety = 0;
    while current_class_addr > 0x10000 && safety < 50 {
        if let Some(class_obj) = obj_mgr.try_save_object(current_class_addr, proc, name_pool, &offsets, 0, 5) {
            hierarchy.push(InspectorHierarchyNode { name: class_obj.name.clone(), type_name: class_obj.type_name.clone(), address: format!("0x{:X}", current_class_addr) });
            // Unreal inheritance chain continues via SuperStruct at offset 0x40
            current_class_addr = proc.memory.try_read_pointer(current_class_addr.wrapping_add(0x40)).unwrap_or(0);
        } else {
            break;
        }
        safety += 1;
    }

    Ok(hierarchy)
}

#[derive(serde::Serialize)]
pub struct InstancePropertyInfo {
    pub property_name: String,
    pub property_type: String,
    pub offset: String,
    pub sub_type: String,
    pub memory_address: String,
    pub live_value: String,
    pub is_object: bool,
    pub object_instance_address: String,
    pub object_class_address: String,
}

#[tauri::command]
pub async fn get_instance_details(state: State<'_, AppState>, instance_address: String, class_address: String) -> Result<Vec<InstancePropertyInfo>, String> {
    let inst_addr = usize::from_str_radix(instance_address.trim_start_matches("0x"), 16).map_err(|_| "Invalid instance address")?;
    let class_addr = usize::from_str_radix(class_address.trim_start_matches("0x"), 16).map_err(|_| "Invalid class address")?;

    let process_lock = state.process.lock().map_err(|_| "Lock failed")?;
    let proc = process_lock.as_ref().ok_or("Process not attached")?;

    let obj_mgr = &state.object_manager;
    let pool_guard = state.name_pool.lock().map_err(|_| "Lock failed")?;
    let name_pool = pool_guard.as_ref().ok_or("Name pool not initialized")?;

    let offsets = crate::backend::unreal::offsets::UEOffset::default();

    // Validate class
    if !obj_mgr.cache_by_address.contains_key(&class_addr) {
        return Err("Class address not valid".to_string());
    }

    let mut results = Vec::new();

    // Walk the properties of the class
    let mut child_addr = proc.memory.try_read_pointer(class_addr.wrapping_add(offsets.member)).unwrap_or(0);
    let mut safety = 0;

    while child_addr > 0x10000 && safety < 500 {
        safety += 1;

        let child_name_id = proc.memory.try_read::<i32>(child_addr.wrapping_add(offsets.member_fname_index)).unwrap_or(0);
        let child_name = name_pool.get_name(proc, child_name_id as u32).unwrap_or_default();

        let child_type_ptr = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
        let child_type_id = proc.memory.try_read::<i32>(child_type_ptr.wrapping_add(offsets.member_type)).unwrap_or(0);
        let child_type = name_pool.get_name(proc, child_type_id as u32).unwrap_or_default();

        let type_lower = child_type.to_lowercase();
        if type_lower.contains("property") {
            let offset_val = proc.memory.try_read::<i32>(child_addr.wrapping_add(offsets.offset)).unwrap_or(0) as usize;

            let mut sub_type = String::new();
            let prop_0 = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.property)).unwrap_or(0);
            let prop_8 = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.property.wrapping_add(8))).unwrap_or(0);
            let type_obj = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.type_object)).unwrap_or(0);

            // Resolve a class name from an address: check cache first, then read FNameIndex directly
            let resolve_name = |addr: usize| -> String {
                if addr < 0x10000 {
                    return String::new();
                }
                if let Some(cached) = obj_mgr.cache_by_address.get(&addr) {
                    if !cached.name.is_empty() && cached.name != "None" {
                        return cached.name.clone();
                    }
                }
                let name_id = proc.memory.try_read::<i32>(addr.wrapping_add(offsets.fname_index)).unwrap_or(0);
                name_pool.get_name(proc, name_id as u32).unwrap_or_default()
            };

            let mut is_object = false;
            let mut object_instance_address = String::new();
            let mut object_class_address = String::new();
            let mut unassigned_live_value: Option<String> = None;

            if type_lower.contains("objectproperty") || type_lower.contains("classproperty") || type_lower.contains("softobjectproperty") || type_lower.contains("weakobjectproperty") || type_lower.contains("interfaceproperty") {
                is_object = true;
                // sub-type is the PropertyClass name: try prop_8 → prop_0 → type_obj
                for &addr in &[prop_8, prop_0, type_obj] {
                    let name = resolve_name(addr);
                    if !name.is_empty() && !name.to_lowercase().contains("property") {
                        sub_type = name;
                        break;
                    }
                }
                let actual_memory_addr = inst_addr.wrapping_add(offset_val);
                let object_ptr = proc.memory.try_read_pointer(actual_memory_addr).unwrap_or(0);
                if object_ptr > 0x10000 {
                    object_instance_address = format!("0x{:X}", object_ptr);
                    if let Some(inst_obj) = obj_mgr.try_save_object(object_ptr, proc, name_pool, &offsets, 0, 5) {
                        let c_addr = proc.memory.try_read_pointer(object_ptr.wrapping_add(offsets.class)).unwrap_or(0);
                        object_class_address = format!("0x{:X}", c_addr);
                        unassigned_live_value = Some(inst_obj.name.clone());
                    }
                }
            } else if type_lower.contains("enumproperty") {
                // EnumProperty stores enum type pointer at type_object (0x70)
                sub_type = resolve_name(type_obj);
            } else if type_lower.contains("arrayproperty") || type_lower.contains("setproperty") {
                // Array/Set: Inner FProperty pointer is at prop_0 (offsets.property = 0x78)
                if prop_0 > 0x10000 {
                    let inner_type_ptr = proc.memory.try_read_pointer(prop_0.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
                    let inner_type_id = proc.memory.try_read::<i32>(inner_type_ptr.wrapping_add(offsets.member_type)).unwrap_or(0);
                    if inner_type_id > 0 && inner_type_id < 2000000 {
                        let inner_type_name = name_pool.get_name(proc, inner_type_id as u32).unwrap_or_default();
                        if inner_type_name.to_lowercase().contains("property") {
                            let mut prop_type_str = inner_type_name.replace("Property", "");
                            if prop_type_str.to_lowercase().contains("object") || prop_type_str.to_lowercase().contains("class") {
                                let inner_class_ptr = proc.memory.try_read_pointer(prop_0.wrapping_add(offsets.property)).unwrap_or(0);
                                let name = resolve_name(inner_class_ptr);
                                if !name.is_empty() {
                                    prop_type_str = name;
                                }
                            }
                            sub_type = prop_type_str;
                        }
                    }
                }
            } else if type_lower.contains("mapproperty") {
                // Map: KeyProp at prop_0, ValueProp at prop_8
                let mut parts = Vec::new();
                for &ptr in &[prop_0, prop_8] {
                    if ptr > 0x10000 {
                        let type_ptr = proc.memory.try_read_pointer(ptr.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
                        let type_id = proc.memory.try_read::<i32>(type_ptr.wrapping_add(offsets.member_type)).unwrap_or(0);
                        if type_id > 0 && type_id < 2000000 {
                            let type_name = name_pool.get_name(proc, type_id as u32).unwrap_or_default();
                            if type_name.to_lowercase().contains("property") {
                                let mut part = type_name.replace("Property", "");
                                if part.to_lowercase().contains("object") || part.to_lowercase().contains("class") {
                                    let inner_ptr = proc.memory.try_read_pointer(ptr.wrapping_add(offsets.property)).unwrap_or(0);
                                    let name = resolve_name(inner_ptr);
                                    if !name.is_empty() {
                                        part = name;
                                    }
                                }
                                parts.push(part);
                            }
                        }
                    }
                }
                if !parts.is_empty() {
                    sub_type = parts.join(", ");
                }
            }

            if !child_name.is_empty() && !child_type.is_empty() {
                let actual_memory_addr = inst_addr.wrapping_add(offset_val);

                // Read Live Value intelligently based on core types
                let live_value = if let Some(val) = unassigned_live_value {
                    val
                } else if type_lower.contains("boolproperty") {
                    let bitmask = proc.memory.try_read::<u8>(child_addr.wrapping_add(offsets.bit_mask)).unwrap_or(0);
                    let memory_byte = proc.memory.try_read::<u8>(actual_memory_addr).unwrap_or(0);
                    let is_true = (memory_byte & bitmask) > 0;
                    if is_true {
                        "True".to_string()
                    } else {
                        "False".to_string()
                    }
                } else if type_lower.contains("nameproperty") {
                    let name_id = proc.memory.try_read::<i32>(actual_memory_addr).unwrap_or(0);
                    let name_str = name_pool.get_name(proc, name_id as u32).unwrap_or_default();
                    if name_str.is_empty() {
                        "None".to_string()
                    } else {
                        name_str
                    }
                } else if type_lower.contains("arrayproperty") {
                    let array_data_ptr = proc.memory.try_read_pointer(actual_memory_addr).unwrap_or(0);
                    let array_count = proc.memory.try_read::<i32>(actual_memory_addr.wrapping_add(0x8)).unwrap_or(0);
                    let array_max = proc.memory.try_read::<i32>(actual_memory_addr.wrapping_add(0xC)).unwrap_or(0);

                    if array_data_ptr > 0x10000 && array_count >= 0 && array_count <= array_max && array_max < 99999 {
                        is_object = true; // Mark expandable
                        object_instance_address = format!("0x{:X}", array_data_ptr);
                        format!("Elements: {}", array_count)
                    } else {
                        "Empty Array".to_string()
                    }
                } else if type_lower.contains("mapproperty") || type_lower.contains("setproperty") {
                    // Native TMap / TSet representation: pointer to data, element count, etc.
                    let map_data_ptr = proc.memory.try_read_pointer(actual_memory_addr).unwrap_or(0);
                    let map_count = proc.memory.try_read::<i32>(actual_memory_addr.wrapping_add(0x18)).unwrap_or(0); // TMap elements count usually at 0x18 based on FScriptMap
                    if map_data_ptr > 0x10000 && map_count >= 0 && map_count < 99999 {
                        is_object = true;
                        object_instance_address = format!("0x{:X}", map_data_ptr);
                        format!("Elements: {}", map_count)
                    } else {
                        "Empty Map".to_string()
                    }
                } else if type_lower.contains("intproperty") || type_lower.contains("int32") {
                    proc.memory.try_read::<i32>(actual_memory_addr).unwrap_or(0).to_string()
                } else if type_lower.contains("floatproperty") {
                    format!("{:.3}", proc.memory.try_read::<f32>(actual_memory_addr).unwrap_or(0.0))
                } else if type_lower.contains("doubleproperty") {
                    format!("{:.5}", proc.memory.try_read::<f64>(actual_memory_addr).unwrap_or(0.0))
                } else if type_lower.contains("byteproperty") {
                    proc.memory.try_read::<u8>(actual_memory_addr).unwrap_or(0).to_string()
                } else {
                    format!("0x{:X}", proc.memory.try_read_pointer(actual_memory_addr).unwrap_or(0))
                };

                let offset_str = if type_lower.contains("boolproperty") {
                    let bitmask = proc.memory.try_read::<u8>(child_addr.wrapping_add(offsets.bit_mask)).unwrap_or(0);
                    let bit_index = if bitmask > 0 { bitmask.trailing_zeros() } else { 0 };
                    format!("{:X}:{}", offset_val, bit_index)
                } else {
                    format!("{:X}", offset_val)
                };

                results.push(InstancePropertyInfo { property_name: child_name, property_type: child_type, offset: offset_str, sub_type, memory_address: format!("0x{:X}", actual_memory_addr), live_value, is_object, object_instance_address, object_class_address });
            }
        }
        child_addr = proc.memory.try_read_pointer(child_addr.wrapping_add(offsets.next_member)).unwrap_or(0);
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_array_elements(state: State<'_, AppState>, array_address: String, inner_type: String, count: i32) -> Result<Vec<InstancePropertyInfo>, String> {
    let array_addr = usize::from_str_radix(array_address.trim_start_matches("0x"), 16).map_err(|_| "Invalid array address")?;

    let process_lock = state.process.lock().map_err(|_| "Lock failed")?;
    let proc = process_lock.as_ref().ok_or("Process not attached")?;
    let obj_mgr = &state.object_manager;
    let pool_guard = state.name_pool.lock().map_err(|_| "Lock failed")?;
    let name_pool = pool_guard.as_ref().ok_or("Name pool not initialized")?;
    let offsets = crate::backend::unreal::offsets::UEOffset::default();

    let mut results = Vec::new();
    let safe_count = count.min(9999); // Hard limit to prevent memory blows

    // Determine stride/size roughly based on `inner_type` (can be enhanced further if needed)
    let type_lower = inner_type.to_lowercase();
    let mut stride = 0x8; // Default pointer/64-bit size

    if type_lower.contains("byte") || type_lower.contains("bool") {
        stride = 0x1;
    } else if type_lower.contains("int") || type_lower.contains("float") {
        stride = 0x4;
    } else if type_lower.contains("double") || type_lower.contains("name") || type_lower.contains("str") {
        stride = 0x8;
    }

    for i in 0..safe_count {
        let element_addr = array_addr.wrapping_add((i as usize) * stride);

        let live_value;
        let mut is_object = false;
        let mut object_instance_address = String::new();
        let mut object_class_address = String::new();

        if type_lower.contains("object") || type_lower.contains("class") {
            let obj_ptr = proc.memory.try_read_pointer(element_addr).unwrap_or(0);
            if obj_ptr > 0x10000 {
                is_object = true;
                object_instance_address = format!("0x{:X}", obj_ptr);
                if let Some(inst_obj) = obj_mgr.try_save_object(obj_ptr, proc, name_pool, &offsets, 0, 5) {
                    let c_addr = proc.memory.try_read_pointer(obj_ptr.wrapping_add(offsets.class)).unwrap_or(0);
                    object_class_address = format!("0x{:X}", c_addr);
                    live_value = inst_obj.name.clone();
                } else {
                    live_value = format!("0x{:X}", obj_ptr);
                }
            } else {
                live_value = "0x0".to_string();
            }
        } else if type_lower.contains("name") {
            let name_id = proc.memory.try_read::<i32>(element_addr).unwrap_or(0);
            live_value = name_pool.get_name(proc, name_id as u32).unwrap_or("None".to_string());
        } else if type_lower.contains("int") {
            live_value = proc.memory.try_read::<i32>(element_addr).unwrap_or(0).to_string();
        } else if type_lower.contains("float") {
            live_value = format!("{:.3}", proc.memory.try_read::<f32>(element_addr).unwrap_or(0.0));
        } else if type_lower.contains("bool") {
            let val = proc.memory.try_read::<u8>(element_addr).unwrap_or(0);
            live_value = if val > 0 { "True".to_string() } else { "False".to_string() };
        } else {
            live_value = format!("0x{:X}", proc.memory.try_read_pointer(element_addr).unwrap_or(0));
        }

        results.push(InstancePropertyInfo {
            property_name: format!("[{}]", i),
            property_type: inner_type.clone(),
            offset: format!("{:X}", (i as usize) * stride),
            sub_type: String::new(),
            memory_address: format!("0x{:X}", element_addr),
            live_value,
            is_object,
            object_instance_address,
            object_class_address,
        });
    }

    Ok(results)
}
