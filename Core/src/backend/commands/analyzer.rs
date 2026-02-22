use crate::backend::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn analyze_fname(state: State<'_, AppState>, id: u32) -> Result<String, String> {
    let process = state.process.lock().unwrap().clone().ok_or("No process attached")?;

    let name_pool_guard = state.name_pool.lock().unwrap();
    let name_pool = name_pool_guard.as_ref().ok_or("FNamePool not yet parsed. Please parse GUObjectArray first.")?;

    name_pool.get_name(&process, id).map_err(|e| format!("Failed to read FName {}: {}", id, e))
}

#[derive(serde::Serialize)]
pub struct RawObjectInfo {
    pub object_id: i32,
    pub type_name: String,
    pub name: String,
    pub full_name: String,
    pub address: String,

    pub offset: String,
    pub class_ptr: String,
    pub outer_ptr: String,
    pub super_ptr: String,
    pub prop_size: String,
    pub prop_0: String,
    pub prop_8: String,
    pub function_ptr: String,
    pub member_ptr: String,
    pub member_size: String,
    pub bit_mask: String,
}

#[tauri::command]
pub async fn analyze_object(state: State<'_, AppState>, address_str: String) -> Result<RawObjectInfo, String> {
    let addr = usize::from_str_radix(address_str.trim_start_matches("0x"), 16).map_err(|_| "Invalid hex address format")?;

    let process = state.process.lock().unwrap().clone().ok_or("No process attached")?;
    let pool_guard = state.name_pool.lock().map_err(|_| "Lock failed")?;
    let name_pool = pool_guard.as_ref().ok_or("Name pool not initialized")?;
    let offsets = crate::backend::unreal::offsets::UEOffset::default();

    // Helper to format pointers elegantly
    let ptr_fmt = |val: usize| {
        if val == 0 {
            "0x0".to_string()
        } else {
            format!("0x{:X}", val)
        }
    };

    // Read base object structure
    let id = process.memory.try_read::<i32>(addr.wrapping_add(offsets.id)).unwrap_or(0);
    let class_ptr = process.memory.try_read_pointer(addr.wrapping_add(offsets.class)).unwrap_or(0);
    let outer_ptr = process.memory.try_read_pointer(addr.wrapping_add(offsets.outer)).unwrap_or(0);
    let name_id = process.memory.try_read::<i32>(addr.wrapping_add(offsets.fname_index)).unwrap_or(0);

    let name = name_pool.get_name(&process, name_id as u32).unwrap_or_else(|_| "Invalid_Name".to_string());

    // Attempt to get Type Name (from Class)
    let type_name = if class_ptr > 0x10000 {
        let class_name_id = process.memory.try_read::<i32>(class_ptr.wrapping_add(offsets.fname_index)).unwrap_or(0);
        name_pool.get_name(&process, class_name_id as u32).unwrap_or_else(|_| "Unknown Class".to_string())
    } else {
        "None".to_string()
    };

    // Build full path Name (Outer chain) limit depth
    let mut current_outer = outer_ptr;
    let mut path = vec![name.clone()];
    let mut depth = 0;
    while current_outer > 0x10000 && depth < 10 {
        let out_name_id = process.memory.try_read::<i32>(current_outer.wrapping_add(offsets.fname_index)).unwrap_or(0);
        if let Ok(n) = name_pool.get_name(&process, out_name_id as u32) {
            if !n.is_empty() && n != "None" {
                path.push(n);
            }
        }
        current_outer = process.memory.try_read_pointer(current_outer.wrapping_add(offsets.outer)).unwrap_or(0);
        depth += 1;
    }
    path.reverse();
    let full_name = path.join(".");

    // Standard specific struct reads
    let super_ptr = process.memory.try_read_pointer(addr.wrapping_add(offsets.super_struct)).unwrap_or(0);
    let prop_size = process.memory.try_read::<i32>(addr.wrapping_add(offsets.prop_size)).unwrap_or(0);
    let offset_val = process.memory.try_read::<i32>(addr.wrapping_add(offsets.offset)).unwrap_or(0);

    let prop_0 = process.memory.try_read_pointer(addr.wrapping_add(offsets.property)).unwrap_or(0);
    let prop_8 = process.memory.try_read_pointer(addr.wrapping_add(offsets.property + 8)).unwrap_or(0);

    let function_ptr = process.memory.try_read_pointer(addr.wrapping_add(offsets.funct)).unwrap_or(0);
    let member_ptr = process.memory.try_read_pointer(addr.wrapping_add(offsets.member)).unwrap_or(0);
    let member_size = process.memory.try_read::<i32>(addr.wrapping_add(offsets.member_size)).unwrap_or(0);
    let bit_mask = process.memory.try_read::<u8>(addr.wrapping_add(offsets.bit_mask)).unwrap_or(0);

    Ok(RawObjectInfo {
        object_id: id,
        type_name,
        name,
        full_name,
        address: ptr_fmt(addr),
        offset: format!("0x{:X}", offset_val),
        class_ptr: ptr_fmt(class_ptr),
        outer_ptr: ptr_fmt(outer_ptr),
        super_ptr: ptr_fmt(super_ptr),
        prop_size: format!("0x{:X} ({})", prop_size, prop_size),
        prop_0: ptr_fmt(prop_0),
        prop_8: ptr_fmt(prop_8),
        function_ptr: ptr_fmt(function_ptr),
        member_ptr: ptr_fmt(member_ptr),
        member_size: format!("0x{:X} ({})", member_size, member_size),
        bit_mask: format!("0x{:02X}", bit_mask),
    })
}
