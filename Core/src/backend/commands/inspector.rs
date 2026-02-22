use crate::backend::state::AppState;
use tauri::State;

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
