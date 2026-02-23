use crate::backend::os::process::Process;
use crate::backend::unreal::name_pool::FNamePool;
use crate::backend::unreal::offsets::UEOffset;
use dashmap::DashMap;
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Emitter;

// ─── Data Structures ─────────────────────────────────────────────

/// Lightweight object reference (mirrors C++ BasicObjectData)
#[derive(Debug, Clone, Default)]
pub struct BasicObjectData {
    pub id: i32,
    pub offset: i16,
    pub type_name: String,
    pub name: String,
    pub full_name: String,
    pub address: usize,
}

/// Full cached object data (mirrors C++ ObjectData : BasicObjectData)
#[derive(Debug, Clone)]
pub struct ObjectData {
    // ─── BasicObjectData fields ───
    pub address: usize,
    pub id: i32,
    pub name: String,
    pub type_name: String,
    pub full_name: String,
    pub outer: usize,

    // ─── Extended fields (C++ ObjectData) ───
    pub class_ptr: usize,            // Raw class pointer address
    pub class_info: BasicObjectData, // Resolved class info (C++: ClassPtr)
    pub super_ptr: usize,            // Raw super struct pointer address
    pub super_info: BasicObjectData, // Resolved super info (C++: SuperPtr)

    pub offset: i16,
    pub prop_size: i16,
    pub property: Vec<BasicObjectData>, // Property sub-objects
    pub sub_type: Vec<usize>,           // SubType addresses

    pub member_ptr: BasicObjectData, // First member child (C++: MemberPtr)
    pub member_size: usize,

    pub bit_mask: i32,
    pub funct: usize, // Function address
}

impl ObjectData {
    pub fn empty() -> Self {
        Self {
            address: 0,
            id: 0,
            name: String::new(),
            type_name: String::new(),
            full_name: String::new(),
            outer: 0,
            class_ptr: 0,
            class_info: BasicObjectData::default(),
            super_ptr: 0,
            super_info: BasicObjectData::default(),
            offset: 0,
            prop_size: 0,
            property: Vec::new(),
            sub_type: Vec::new(),
            member_ptr: BasicObjectData::default(),
            member_size: 0,
            bit_mask: 0,
            funct: 0,
        }
    }

    /// C++: BasicObjectDataWapper — pack ObjectData into BasicObjectData
    pub fn to_basic(&self) -> BasicObjectData {
        BasicObjectData { id: self.id, offset: self.offset, type_name: self.type_name.clone(), name: self.name.clone(), full_name: self.full_name.clone(), address: self.address }
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

    pub fn clear(&self) {
        self.cache_by_address.clear();
        self.cache_by_id.clear();
        self.total_object_count.store(0, Ordering::Relaxed);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TrySaveObject — 100% faithful port of C++ Object.cpp:256-377
    // ═══════════════════════════════════════════════════════════════

    pub fn try_save_object(&self, address: usize, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, depth: usize, max_depth: usize) -> Option<ObjectData> {
        // ─── IsPointer check (C++ line 264) ───
        if address < 0x10000 {
            return None;
        }
        if process.memory.try_read_pointer(address).is_none() {
            return None;
        }

        // ─── Check cache: if already processed, return immediately (C++ line 267) ───
        if let Some(cached) = self.cache_by_address.get(&address) {
            if !cached.full_name.is_empty() || cached.type_name.contains("Property") || cached.type_name.contains("Function") {
                return Some(cached.clone());
            }
        }

        // ─── GetBasicInfo (C++ line 270-271) ───
        let mut obj = ObjectData::empty();
        // C++: ClassPtr is captured by GetBasicInfo_2 into obj.class_ptr
        if !self.get_basic_info_1(address, &mut obj, process, name_pool, offsets) {
            if !self.get_basic_info_2(address, &mut obj, process, name_pool, offsets) {
                return None;
            }
        }
        obj.address = address;
        if obj.name.is_empty() {
            obj.name = "InvalidName".to_string();
        }
        if obj.type_name.is_empty() || obj.type_name.len() > 100 {
            return None;
        }

        // ─── Early return for None/InvalidName (C++ lines 273-274) ───
        if obj.name == "None" || obj.name == "InvalidName" {
            return Some(obj);
        }

        // ─── GetFullName (C++ lines 277-278) ───
        if !obj.type_name.contains("Property") && obj.address != obj.outer {
            if obj.outer > 0x10000 {
                self.resolve_full_name(&mut obj, process, name_pool, offsets, depth, max_depth);
            } else {
                obj.full_name = obj.name.clone();
            }
        } else {
            obj.full_name = obj.name.clone();
        }

        // ─── Level/depth overflow check (C++ line 282) ───
        // C++: if (MaxLevel - Level >= MaxLevel) return true; → means Level == 0 → depth used up
        if depth >= max_depth {
            return Some(obj);
        }

        // ─── First-time save block (C++ lines 284-303) ───
        {
            // Save to ID table (C++ lines 286-293) — only for non-Property objects
            if self.cache_by_id.contains_key(&obj.id) {
                return Some(obj);
            }
            if !obj.type_name.contains("Property") {
                if (obj.id as u32) < 0xFFFFFFFF {
                    self.cache_by_id.insert(obj.id, address);
                }
            }

            // Save to address table (C++ lines 296-297)
            if self.cache_by_address.contains_key(&address) {
                return Some(obj);
            }
            self.cache_by_address.insert(address, obj.clone());
        }

        // ─── Object counter (C++ line 312) ───
        self.total_object_count.fetch_add(1, Ordering::Relaxed);

        // ═══════════════════════════════════════════════════════════
        //  Deep analysis — C++ lines 320-368
        //  These recursive calls discover additional objects!
        // ═══════════════════════════════════════════════════════════

        // ─── Recursive: resolve ClassPtr (C++ lines 320-327) ───
        if obj.class_ptr > 0x10000 {
            if let Some(class_obj) = self.try_save_object(obj.class_ptr, process, name_pool, offsets, depth + 1, max_depth) {
                obj.class_info = class_obj.to_basic();
            }
        }

        // ─── Recursive: resolve SuperPtr (C++ lines 333-343) ───
        let super_addr = process.memory.try_read_pointer(address.wrapping_add(offsets.super_struct)).unwrap_or(0);
        if super_addr > 0x10000 {
            obj.super_ptr = super_addr;
            if let Some(super_obj) = self.try_save_object(super_addr, process, name_pool, offsets, depth + 1, max_depth) {
                obj.super_info = super_obj.to_basic();
            }
        }

        // ─── Property / Member / Function branches (C++ lines 346-368) ───
        if obj.type_name.contains("Property") {
            // GetProperty (C++ lines 347-351)
            self.get_property(&mut obj, address, process, name_pool, offsets, depth, max_depth);
        } else {
            // GetMember (C++ lines 354-358)
            self.get_member(&mut obj, address, process, name_pool, offsets, depth, max_depth);
        }

        if obj.type_name.contains("Function") {
            // GetFunction (C++ lines 365-367)
            obj.funct = process.memory.try_read_pointer(address.wrapping_add(offsets.funct)).unwrap_or(0);
        }

        // ─── Final save: update with complete data (C++ line 371) ───
        self.cache_by_address.insert(address, obj.clone());

        Some(obj)
    }

    // ═══════════════════════════════════════════════════════════════
    //  GetBasicInfo_1 — C++ Object.cpp lines 23-46
    //  For special objects (Members/Properties): reads via MemberTypeOffset
    // ═══════════════════════════════════════════════════════════════

    fn get_basic_info_1(&self, address: usize, obj: &mut ObjectData, process: &Process, name_pool: &FNamePool, offsets: &UEOffset) -> bool {
        // ID
        obj.id = process.memory.try_read::<i32>(address.wrapping_add(offsets.id)).unwrap_or(0);
        // Outer
        obj.outer = process.memory.try_read_pointer(address.wrapping_add(offsets.outer)).unwrap_or(0);

        // Type via MemberTypeOffset chain
        let type_ptr = process.memory.try_read_pointer(address.wrapping_add(offsets.member_type_offset)).unwrap_or(0);
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
        if obj.name.is_empty() {
            return !obj.type_name.is_empty();
        }

        true
    }

    // ═══════════════════════════════════════════════════════════════
    //  GetBasicInfo_2 — C++ Object.cpp lines 48-70
    //  Standard path: reads via Class pointer
    // ═══════════════════════════════════════════════════════════════

    fn get_basic_info_2(&self, address: usize, obj: &mut ObjectData, process: &Process, name_pool: &FNamePool, offsets: &UEOffset) -> bool {
        // Class
        obj.class_ptr = process.memory.try_read_pointer(address.wrapping_add(offsets.class)).unwrap_or(0);

        // Type (from Class's FNameIndex)
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

    // ═══════════════════════════════════════════════════════════════
    //  GetFullName — C++ Object.cpp lines 83-109
    //  Chase the Outer chain, calling TrySaveObject on each Outer
    // ═══════════════════════════════════════════════════════════════

    fn resolve_full_name(&self, obj: &mut ObjectData, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, depth: usize, max_depth: usize) {
        // C++: int ConcateOuterCnt = 0; int MaxConcateOuterCnt = 10;
        let mut concat_count = 0;
        let max_concat = 10;

        // C++: std::string TempStr = RetObjectData.Name;
        let mut result = obj.name.clone();
        // C++: NewObj = RetObjectData;
        let mut current = obj.clone();

        loop {
            if concat_count >= max_concat {
                break;
            }
            concat_count += 1;

            // C++: OldObj = NewObj;
            let old_obj = current.clone();

            // C++: if (NewObj.Outer == NULL or !TrySaveObject(NewObj.Outer, NewObj, Level - 1)) break;
            if current.outer == 0 || current.outer < 0x10000 {
                break;
            }
            let new_obj = match self.try_save_object(current.outer, process, name_pool, offsets, depth.saturating_sub(1), max_depth) {
                Some(o) => o,
                None => break,
            };

            // C++: separator logic
            let is_old_prop_or_func = old_obj.type_name.contains("Property") || old_obj.type_name.contains("Function");
            let is_new_prop_or_func = new_obj.type_name.contains("Property") || new_obj.type_name.contains("Function");
            let sep = if is_old_prop_or_func && !is_new_prop_or_func { ":" } else { "." };

            result = format!("{}{}{}", new_obj.name, sep, result);
            current = new_obj;
        }

        obj.full_name = result;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PropertyProcess — C++ Object.cpp lines 111-127
    //  TrySaveObject on a sub-object address, push to property/sub_type
    // ═══════════════════════════════════════════════════════════════

    fn property_process(&self, obj: &mut ObjectData, address: usize, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, depth: usize, max_depth: usize) -> bool {
        if let Some(prop_obj) = self.try_save_object(address, process, name_pool, offsets, depth + 1, max_depth) {
            let basic = prop_obj.to_basic();
            obj.property.push(basic);

            // SubType: if the property object has no sub-properties, use its address; otherwise use its first property's address
            if prop_obj.property.is_empty() {
                obj.sub_type.push(prop_obj.address);
            } else {
                obj.sub_type.push(prop_obj.property[0].address);
            }
            true
        } else {
            false
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GetProperty — C++ Object.cpp lines 129-184
    //  Read Offset, PropSize, Property_0/8, TypeObject, BitMask
    //  Then recursively resolve sub-types
    // ═══════════════════════════════════════════════════════════════

    fn get_property(&self, obj: &mut ObjectData, address: usize, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, depth: usize, max_depth: usize) {
        // Read Offset, PropSize
        obj.offset = process.memory.try_read::<i16>(address.wrapping_add(offsets.offset)).unwrap_or(0);
        obj.prop_size = process.memory.try_read::<i16>(address.wrapping_add(offsets.prop_size)).unwrap_or(0);

        // Read Property_0, Property_8, TypeObject, BitMask
        let property_0 = process.memory.try_read_pointer(address.wrapping_add(offsets.property)).unwrap_or(0);
        let property_8 = process.memory.try_read_pointer(address.wrapping_add(offsets.property + 8)).unwrap_or(0);
        let type_object = process.memory.try_read_pointer(address.wrapping_add(offsets.type_object)).unwrap_or(0);
        obj.bit_mask = process.memory.try_read::<i32>(address.wrapping_add(offsets.bit_mask)).unwrap_or(0);

        let type_name = &obj.type_name;

        if type_name.contains("StructProperty") || type_name.contains("ObjectProperty") || type_name.contains("ClassProperty") || type_name.contains("ArrayProperty") || type_name.contains("EnumProperty") || type_name.contains("ByteProperty") {
            // C++ lines 161-166: try Property_8 → Property_0 → TypeObject
            if !self.property_process(obj, property_8, process, name_pool, offsets, depth, max_depth) {
                if !self.property_process(obj, property_0, process, name_pool, offsets, depth, max_depth) {
                    self.property_process(obj, type_object, process, name_pool, offsets, depth, max_depth);
                }
            }
        } else if type_name.contains("MapProperty") {
            // C++ lines 169-177: MapProperty
            if self.try_save_object(property_8, process, name_pool, offsets, depth + 1, max_depth).is_some() {
                self.property_process(obj, property_0, process, name_pool, offsets, depth, max_depth);
                self.property_process(obj, property_8, process, name_pool, offsets, depth, max_depth);
            } else if self.try_save_object(property_0, process, name_pool, offsets, depth + 1, max_depth).is_some() {
                self.property_process(obj, type_object, process, name_pool, offsets, depth, max_depth);
                self.property_process(obj, property_0, process, name_pool, offsets, depth, max_depth);
            }
        } else if type_name.contains("BoolProperty") {
            // C++ lines 180-181: BoolProperty — just store BitMask (already read above)
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GetMember — C++ Object.cpp lines 186-199
    //  Read the first Member child and its size
    // ═══════════════════════════════════════════════════════════════

    fn get_member(&self, obj: &mut ObjectData, address: usize, process: &Process, name_pool: &FNamePool, offsets: &UEOffset, depth: usize, max_depth: usize) {
        let member_address = process.memory.try_read_pointer(address.wrapping_add(offsets.member)).unwrap_or(0);
        // C++: TrySaveObject(MemberAddress, MemberObject, Level - 1, true)  — SkipGetFullName = true
        if let Some(member_obj) = self.try_save_object(member_address, process, name_pool, offsets, depth + 1, max_depth) {
            obj.member_ptr = member_obj.to_basic();
            obj.member_size = process.memory.try_read::<usize>(address.wrapping_add(offsets.member + 8)).unwrap_or(0);
        }
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

            // IsPointer check — skip NULL/freed slots (holes in GUObjectArray)
            if addr_level_3 < 0x10000 || process.memory.try_read_pointer(addr_level_3).is_none() {
                continue;
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
            let arr_idx = i / loop_step;
            let arr_total = MAX_OBJECT_ARRAY / loop_step;

            app_handle.emit("guobject-array-progress", ProgressPayload { current_chunk: arr_idx, total_chunks: arr_total, current_objects: obj_mgr.total_object_count.load(Ordering::Relaxed), total_objects: dynamic_total.load(Ordering::Relaxed) }).ok();

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

                if bp % 5 == 0 || bp == split_size {
                    // Use high-watermark so total never shrinks — progress bar won't regress
                    let displayed_total = dynamic_total.fetch_max(current_obj_count + 1, Ordering::Relaxed).max(current_obj_count + 1);
                    app_handle.emit("guobject-array-progress", ProgressPayload { current_chunk: arr_idx, total_chunks: arr_total, current_objects: current_obj_count, total_objects: displayed_total }).ok();
                }
            });

            // loop_future.wait() is implicit — Rayon blocks until all tasks complete

            i += loop_step;
        }

        let final_count = obj_mgr.total_object_count.load(Ordering::Relaxed);

        // Final progress: 100%
        app_handle.emit("guobject-array-progress", ProgressPayload { current_chunk: MAX_OBJECT_ARRAY / loop_step, total_chunks: MAX_OBJECT_ARRAY / loop_step, current_objects: final_count, total_objects: final_count }).ok();

        println!("[ GUObjectArray Total Objects ] {}", final_count);
        println!("[ GUObjectArray Cache Size ] {}", obj_mgr.cache_by_address.len());

        Ok(final_count as u32)
    }
}
