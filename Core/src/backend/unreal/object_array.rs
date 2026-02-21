use crate::backend::os::process::Process;
use crate::backend::unreal::name_pool::FNamePool;
use crate::backend::unreal::offsets::UEOffset;
use dashmap::DashMap;
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Emitter;

// ─── Data Structures ─────────────────────────────────────────────

/// Cached object data, mirrors the legacy ObjectData struct
#[derive(Debug, Clone)]
pub struct ObjectData {
    pub address: usize,
    pub id: i32,
    pub name: String,
    pub type_name: String,
    pub full_name: String,
    pub outer: usize,
    pub class_ptr: usize,
}

impl ObjectData {
    pub fn empty() -> Self {
        Self { address: 0, id: 0, name: String::new(), type_name: String::new(), full_name: String::new(), outer: 0, class_ptr: 0 }
    }
}

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    current_chunk: usize,
    total_chunks: usize,
    current_objects: usize,
    total_objects: usize,
}

// ─── ObjectManager (Two-Tier DashMap Cache) ──────────────────────

/// Thread-safe object cache using DashMap for concurrent read/write
pub struct ObjectManager {
    /// Primary cache: Address -> ObjectData (prevents duplicate analysis)
    pub cache_by_address: DashMap<usize, ObjectData>,
    /// Secondary cache: ID -> Address (quick lookup by object ID)
    pub cache_by_id: DashMap<i32, usize>,
    /// Object counter
    pub total_object_count: AtomicUsize,
}

impl ObjectManager {
    pub fn new() -> Self {
        Self { cache_by_address: DashMap::new(), cache_by_id: DashMap::new(), total_object_count: AtomicUsize::new(0) }
    }

    /// Try to save an object. Returns cached data if already processed.
    /// This is the core two-tier mechanism:
    ///   Tier 1: Check cache -> if exists, return immediately (prevents infinite recursion)
    ///   Tier 2: Get basic info, insert partial data, then resolve relations and update
    pub fn try_save_object(&self, address: usize, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, depth: usize, max_depth: usize) -> Option<ObjectData> {
        // Guard: null pointer
        if address < 0x10000 {
            return None;
        }

        // Guard: depth limit to prevent stack overflow
        if depth >= max_depth {
            return None;
        }

        // Guard: validate it is a readable pointer (fast path: no String allocation)
        if process.memory.try_read_pointer(address).is_none() {
            return None;
        }

        // ═══ Tier 1: Check cache ═══
        if let Some(cached) = self.cache_by_address.get(&address) {
            return Some(cached.clone());
        }

        // ═══ Tier 2: Parse basic info ═══
        let mut obj = ObjectData::empty();
        obj.address = address;

        // GetBasicInfo: try path 1, if fails try path 2 (matching original C++)
        if !self.get_basic_info_1(address, &mut obj, process, name_pool, offsets) {
            if !self.get_basic_info_2(address, &mut obj, process, name_pool, offsets) {
                return None;
            }
        }
        // Original C++: RetObjectData.Address = Address;
        obj.address = address;
        // Original C++: if (Name.empty()) Name = "InvalidName";
        if obj.name.is_empty() {
            obj.name = "InvalidName".to_string();
        }
        // Original C++: if (Name.empty() or Type.empty() or Type.length() > 100) return false;
        if obj.type_name.is_empty() || obj.type_name.len() > 100 {
            return None;
        }
        if obj.name == "None" || obj.name == "InvalidName" {
            return Some(obj);
        }

        // ═══ Tier 1 Insert: Save partial data immediately to prevent recursion ═══
        self.cache_by_address.insert(address, obj.clone());
        if obj.id > 0 && (obj.id as u32) < 0xFFFFFFFF && !obj.type_name.contains("Property") {
            self.cache_by_id.insert(obj.id, address);
        }

        // ═══ Resolve FullName (chase Outer chain) ═══
        if !obj.type_name.contains("Property") && obj.address != obj.outer {
            self.resolve_full_name(&mut obj, process, name_pool, offsets, depth + 1, max_depth);
        }

        // ═══ Tier 2 Insert: Update with complete data ═══
        self.cache_by_address.insert(address, obj.clone());
        self.total_object_count.fetch_add(1, Ordering::Relaxed);

        Some(obj)
    }

    /// GetBasicInfo_1: For special objects (Members/Properties) — reads via MemberTypeOffset
    /// Faithful to original C++: no extra pointer validation, only ReadMem failures cause return false
    fn get_basic_info_1(&self, address: usize, obj: &mut ObjectData, process: &Process, name_pool: &FNamePool, offsets: &UEOffset) -> bool {
        // ID
        obj.id = process.memory.try_read::<i32>(address.wrapping_add(offsets.id)).unwrap_or(0);
        // Outer
        obj.outer = process.memory.try_read_pointer(address.wrapping_add(offsets.outer)).unwrap_or(0);

        // Type via MemberTypeOffset chain
        let type_ptr = process.memory.try_read_pointer(address.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
        // Original C++: if (!ReadMem(type, Address_Level_1 + MemberType)) return false;
        let type_id = match process.memory.try_read::<i32>(type_ptr.wrapping_add(offsets.member_type)) {
            Some(v) => v,
            None => return false,
        };
        obj.type_name = name_pool.get_name(process, type_id as u32).unwrap_or_default();
        if obj.type_name.is_empty() {
            return false;
        }

        // Name via MemberFNameIndex
        let name_id = process.memory.try_read::<i32>(address.wrapping_add(offsets.member_fname_index)).unwrap_or(0);
        obj.name = name_pool.get_name(process, name_id as u32).unwrap_or_default();
        // Original C++: if (Name.empty()) return (!Type.empty()) ? true : false;
        if obj.name.is_empty() {
            return !obj.type_name.is_empty();
        }

        true
    }

    /// GetBasicInfo_2: Standard path — reads via Class pointer
    /// Faithful to original C++: no IsPointer check on Class, returns false only on ReadMem failure
    fn get_basic_info_2(&self, address: usize, obj: &mut ObjectData, process: &Process, name_pool: &FNamePool, offsets: &UEOffset) -> bool {
        // Class
        obj.class_ptr = process.memory.try_read_pointer(address.wrapping_add(offsets.class)).unwrap_or(0);

        // Type (from Class's FNameIndex)
        // Original C++: if (!ReadMem(type, Class + FNameIndex)) return false;
        let type_id = match process.memory.try_read::<i32>(obj.class_ptr.wrapping_add(offsets.fname_index)) {
            Some(v) => v,
            None => return false,
        };
        obj.type_name = name_pool.get_name(process, type_id as u32).unwrap_or_default();

        // Name
        let name_id = process.memory.try_read::<i32>(address.wrapping_add(offsets.fname_index)).unwrap_or(0);
        obj.name = name_pool.get_name(process, name_id as u32).unwrap_or_default();

        // ID
        obj.id = process.memory.try_read::<i32>(address.wrapping_add(offsets.id)).unwrap_or(0);

        // Outer
        obj.outer = process.memory.try_read_pointer(address.wrapping_add(offsets.outer)).unwrap_or(0);

        true
    }

    /// Chase the Outer chain to build the FullName path (e.g., "/Script/Engine.Actor")
    /// This is ITERATIVE (no recursive try_save_object) to prevent stack overflow.
    fn resolve_full_name(&self, obj: &mut ObjectData, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, _depth: usize, _max_depth: usize) {
        let mut result = obj.name.clone();
        let mut current_outer = obj.outer;
        let mut concat_count = 0;
        let max_concat = 10;
        let mut prev_type = obj.type_name.clone();

        while current_outer > 0x10000 && concat_count < max_concat {
            concat_count += 1;

            // Check cache first (no recursive full analysis)
            if let Some(cached) = self.cache_by_address.get(&current_outer) {
                let is_prev_prop_or_func = prev_type.contains("Property") || prev_type.contains("Function");
                let is_outer_prop_or_func = cached.type_name.contains("Property") || cached.type_name.contains("Function");
                let sep = if is_prev_prop_or_func && !is_outer_prop_or_func { ":" } else { "." };
                result = format!("{}{}{}", cached.name, sep, result);
                prev_type = cached.type_name.clone();
                current_outer = cached.outer;
                continue;
            }

            // Shallow resolve: only get basic info, insert into cache, do NOT recurse into FullName
            if process.memory.try_read_pointer(current_outer).is_none() {
                break;
            }
            let mut outer_obj = ObjectData::empty();
            outer_obj.address = current_outer;
            if !self.get_basic_info_1(current_outer, &mut outer_obj, process, name_pool, offsets) {
                self.get_basic_info_2(current_outer, &mut outer_obj, process, name_pool, offsets);
            }
            if outer_obj.type_name.is_empty() || outer_obj.name.is_empty() {
                break;
            }

            // Cache this shallow result
            self.cache_by_address.insert(current_outer, outer_obj.clone());

            let is_prev_prop_or_func = prev_type.contains("Property") || prev_type.contains("Function");
            let is_outer_prop_or_func = outer_obj.type_name.contains("Property") || outer_obj.type_name.contains("Function");
            let sep = if is_prev_prop_or_func && !is_outer_prop_or_func { ":" } else { "." };
            result = format!("{}{}{}", outer_obj.name, sep, result);
            prev_type = outer_obj.type_name.clone();
            current_outer = outer_obj.outer;
        }

        obj.full_name = result;
    }
}

// ─── GUObjectArray Parser ────────────────────────────────────────

const MAX_OBJECT_ARRAY: usize = 0x1000;
const MAX_OBJECT_QUANTITY: usize = 2_000_000;

pub struct GUObjectArray {
    base_address: usize,
}

impl GUObjectArray {
    pub fn new(base_address: usize) -> Self {
        Self { base_address }
    }

    /// Faithful port of C++ Thread_SearchAllObject
    /// Start/End are ELEMENT INDICES (not byte offsets)
    fn thread_search_all_object(
        obj_mgr: &ObjectManager,
        process: &Process,
        name_pool: &FNamePool,
        offsets: &UEOffset,
        address: usize, // Address_Level_1
        start: usize,
        end: usize,
        element_size: usize,
    ) {
        // Read Address_Level_2 from Address_Level_1 (dereference)
        let addr_level_2 = match process.memory.try_read_pointer(address) {
            Some(addr) => addr,
            None => return,
        };

        for i in start..=end {
            // byte offset = i * element_size (faithful to C++)
            let byte_offset = i.wrapping_mul(element_size);
            let read_addr = addr_level_2.wrapping_add(byte_offset);

            let addr_level_3 = match process.memory.try_read_pointer(read_addr) {
                Some(addr) => addr,
                None => continue, // C++: ReadMem failure just skips the if-block, does NOT break
            };

            // IsPointer check
            if addr_level_3 < 0x10000 || process.memory.try_read_pointer(addr_level_3).is_none() {
                break;
            }

            // TrySaveObject
            obj_mgr.try_save_object(addr_level_3, process, name_pool, offsets, 0, 5);

            // 終止條件: too many objects
            if obj_mgr.total_object_count.load(Ordering::Relaxed) > MAX_OBJECT_QUANTITY {
                return;
            }
        }
    }

    /// Main parser: faithful port of C++ ParseGUObjectArray
    pub fn parse_array(&self, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, element_size: usize, app_handle: &tauri::AppHandle, obj_mgr: &ObjectManager) -> Result<u32, String> {
        let loop_step: usize = 8; // ProcOffestAdd (64-bit)

        // Matching original C++ variable names exactly
        let guobject_array_element_cnt: usize = 0x20;
        let guobject_array_element_size: usize = element_size; // Auto-detected, NOT hardcoded!
        let guobject_array_batch_size: usize = guobject_array_element_size * guobject_array_element_cnt;

        println!("[ GUObjectArray ] Using ElementSize = 0x{:X}, BatchSize = 0x{:X}", guobject_array_element_size, guobject_array_batch_size);

        let dynamic_total = AtomicUsize::new(10_000);

        // 主程式開始，遞迴 GUObjectArray 找到目標 Object
        let mut i: usize = 0;
        while i < MAX_OBJECT_ARRAY {
            // 終止條件
            if obj_mgr.total_object_count.load(Ordering::Relaxed) > MAX_OBJECT_QUANTITY {
                break;
            }

            // ReadMem(Address_Level_1, GUObjectArrayBaseAddress + i)
            let addr_level_1 = match process.memory.read_pointer(self.base_address.wrapping_add(i)) {
                Ok(addr) => addr,
                Err(_) => {
                    i += loop_step;
                    continue;
                }
            };

            // Address_Level_1 Is not Pointer => continue
            if addr_level_1 < 0x10000 || process.memory.read_pointer(addr_level_1).is_err() {
                i += loop_step;
                continue;
            }

            // GetMemoryRegionSizeByAddress
            let region_size = match process.memory.get_memory_region_size(addr_level_1) {
                Ok(size) if size > 0 => size,
                _ => {
                    i += loop_step;
                    continue;
                }
            };

            // SplitGUObjectArraySize = floor((TempGUObjectArraySize / GUObjectArrayBatchSize) + 0.5)
            let split_size = (region_size as f64 / guobject_array_batch_size as f64 + 0.5).floor() as usize;
            if split_size == 0 {
                i += loop_step;
                continue;
            }

            println!("[ {:4} Get Region Size ] 0x{:X} \t{:08X}", i / loop_step + 1, addr_level_1, region_size);

            // Emit progress for Object (Current) bar
            let batch_progress = AtomicUsize::new(0);

            app_handle.emit("guobject-array-progress", ProgressPayload { current_chunk: 0, total_chunks: split_size, current_objects: obj_mgr.total_object_count.load(Ordering::Relaxed), total_objects: dynamic_total.load(Ordering::Relaxed) }).ok();

            // ═══ Rayon parallel: faithful port of Pool.submit_loop(0, SplitGUObjectArraySize, ...) ═══
            (0..split_size).into_par_iter().for_each(|batch_idx| {
                // 終止條件
                if obj_mgr.total_object_count.load(Ordering::Relaxed) > MAX_OBJECT_QUANTITY {
                    return;
                }

                // size_t Start = i * GUObjectArrayBatchSize  (element index)
                let start = batch_idx.wrapping_mul(guobject_array_batch_size);
                // size_t End = Start + GUObjectArrayBatchSize (element index)
                let end = start.wrapping_add(guobject_array_batch_size);

                // Thread_SearchAllObject(Address_Level_1, Start, End, GUObjectArrayElementSize, ...)
                Self::thread_search_all_object(&obj_mgr, process, name_pool, offsets, addr_level_1, start, end, guobject_array_element_size);

                // Progress update
                let bp = batch_progress.fetch_add(1, Ordering::Relaxed) + 1;
                let current_obj_count = obj_mgr.total_object_count.load(Ordering::Relaxed);

                // Dynamic total expansion
                let mut current_target = dynamic_total.load(Ordering::Relaxed);
                while current_obj_count >= current_target {
                    let next_target = current_target.wrapping_mul(2);
                    let _ = dynamic_total.compare_exchange(current_target, next_target, Ordering::Relaxed, Ordering::Relaxed);
                    current_target = dynamic_total.load(Ordering::Relaxed);
                }

                if bp % 5 == 0 || bp == split_size {
                    app_handle.emit("guobject-array-progress", ProgressPayload { current_chunk: bp, total_chunks: split_size, current_objects: current_obj_count, total_objects: current_target }).ok();
                }
            });

            // loop_future.wait() is implicit — Rayon blocks until all tasks complete

            i += loop_step;
        }

        let final_count = obj_mgr.total_object_count.load(Ordering::Relaxed);

        // Final progress: 100%
        app_handle.emit("guobject-array-progress", ProgressPayload { current_chunk: 1, total_chunks: 1, current_objects: final_count, total_objects: final_count }).ok();

        println!("[ GUObjectArray Total Objects ] {}", final_count);
        println!("[ GUObjectArray Cache Size ] {}", obj_mgr.cache_by_address.len());

        Ok(final_count as u32)
    }
}
