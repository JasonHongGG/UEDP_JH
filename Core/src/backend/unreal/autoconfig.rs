use crate::backend::os::process::Process;
use crate::backend::unreal::name_pool::FNamePool;
use crate::backend::unreal::object_array::ObjectManager;
use crate::backend::unreal::offsets::UEOffset;
pub struct AutoConfig {
    pub offsets: UEOffset,
}

impl Default for AutoConfig {
    fn default() -> Self {
        Self::new()
    }
}

impl AutoConfig {
    pub fn new() -> Self {
        Self { offsets: UEOffset::default() }
    }

    /// Helper mirroring DumperUtils::CheckValue for FName strings.
    /// Scans a memory chunk for a 4-byte ID that resolves to an FName containing (or exactly matching) `expected_name`.
    pub fn scan_memory_for_fname(process: &Process, name_pool: &FNamePool, start_address: usize, size: usize, expected_name: &str, exact_match: bool) -> Option<usize> {
        if start_address == 0 {
            return None;
        }

        let buffer = process.memory.read_bytes(start_address, size).ok()?;

        for i in (0..size).step_by(4) {
            if i + 4 > buffer.len() {
                break;
            }

            let id_val = u32::from_le_bytes(buffer[i..i + 4].try_into().unwrap());

            if let Ok(name_str) = name_pool.get_name(process, id_val) {
                if !name_str.is_empty() {
                    let matches = if exact_match { name_str == expected_name } else { name_str.contains(expected_name) };

                    if matches {
                        return Some(start_address + i);
                    }
                }
            }
        }
        None
    }

    /// Helper mirroring DumperUtils::CheckValue for integer Types.
    /// Scans a memory chunk for an integer value `expected_val` or within a range `[expected_val, max_val]`.
    pub fn scan_memory_for_int(process: &Process, start_address: usize, size: usize, expected_val: u32, max_val: Option<u32>, bytes_type: usize) -> Option<usize> {
        if start_address == 0 {
            return None;
        }

        let buffer = process.memory.read_bytes(start_address, size).ok()?;

        for i in (0..size).step_by(bytes_type) {
            if i + bytes_type > buffer.len() {
                break;
            }

            let val = match bytes_type {
                2 => u16::from_le_bytes(buffer[i..i + 2].try_into().unwrap()) as u32,
                4 => u32::from_le_bytes(buffer[i..i + 4].try_into().unwrap()),
                8 => u64::from_le_bytes(buffer[i..i + 8].try_into().unwrap()) as u32,
                _ => return None,
            };

            if let Some(upper) = max_val {
                if val >= expected_val && upper >= expected_val && upper >= val {
                    return Some(start_address + i);
                }
            } else if val == expected_val {
                return Some(start_address + i);
            }
        }
        None
    }

    /// Port of C++ FindBasicInfoOffset to find FNameIndex, ID, Outer, Class offsets
    pub fn find_basic_info_offset(&mut self, process: &Process, name_pool: &FNamePool, gu_object_base: usize, element_size: usize) -> Result<(), String> {
        let mut found_outer = false;
        let mut found_class = false;

        let object_array_entry = process.memory.read_pointer(gu_object_base.wrapping_add(0x10)).map_err(|e| format!("Failed to read GUObjectArray entry: {}", e))?;

        for i in 0..=10 {
            let chunk_ptr = process.memory.read_pointer(object_array_entry).unwrap_or(0);
            if chunk_ptr == 0 {
                continue;
            }

            let object_entry = process.memory.read_pointer(chunk_ptr.wrapping_add(i * element_size)).unwrap_or(0);
            if object_entry == 0 {
                continue;
            }

            // 1. Find FNameIndex (look for string "Object" in the object_entry + 0x8 to 0x88)
            let search_start = object_entry.wrapping_add(0x8);
            let search_size = 0x80;

            if let Some(name_address) = Self::scan_memory_for_fname(process, name_pool, search_start, search_size, "Object", true) {
                self.offsets.fname_index = name_address - object_entry;

                // 2. Find Object ID (look for integer i in the same area)
                if let Some(id_address) = Self::scan_memory_for_int(process, search_start, search_size, i as u32, None, 4) {
                    self.offsets.id = id_address - object_entry;
                }

                // 3. Find Outer and Class by scanning pointer members
                for j in (0x8..=0x80).step_by(0x8) {
                    let sub_object_entry = process.memory.read_pointer(object_entry.wrapping_add(j)).unwrap_or(0);

                    if sub_object_entry > 0x10000 && sub_object_entry < 0x0000_7FFF_FFFF_FFFF {
                        if let Ok(temp_fname_id) = process.memory.read::<u32>(sub_object_entry.wrapping_add(self.offsets.fname_index)) {
                            if let Ok(temp_fname_str) = name_pool.get_name(process, temp_fname_id) {
                                if temp_fname_str.contains("Core") {
                                    self.offsets.outer = j;
                                    found_outer = true;
                                } else if temp_fname_str.contains("Class") {
                                    self.offsets.class = j;
                                    found_class = true;
                                }
                            }
                        }
                    }

                    if found_outer && found_class {
                        break;
                    }
                }
            }

            if found_outer && found_class {
                break;
            }
        }

        Ok(())
    }

    /// Port of C++ FindSuperAndMemberOffset
    pub fn find_super_and_member_offset(&mut self, process: &Process, name_pool: &FNamePool, object_manager: &ObjectManager, game_engine_object_address: usize) -> Result<usize, String> {
        let mut engine_or_actor_address = 0;
        let mut found_super = false;
        let mut found_next_member = false;
        let check_level = 2;

        let start_offset = self.offsets.outer + 0x8;
        for i in (start_offset..0x100).step_by(0x8) {
            let sub_object_entry = match process.memory.read_pointer(game_engine_object_address.wrapping_add(i)) {
                Ok(ptr) => ptr,
                Err(_) => continue,
            };

            if let Some(temp_obj) = object_manager.try_save_object(sub_object_entry, process, name_pool, &self.offsets, 0, 5, true) {
                // Condition 1: find Super
                if !found_super && (temp_obj.full_name.contains("Engine.Engine") || temp_obj.full_name.contains("Engine.Actor")) {
                    self.offsets.super_struct = i;
                    found_super = true;
                    engine_or_actor_address = sub_object_entry;
                }

                // Condition 2: find Member, NextMember
                if (temp_obj.type_name.contains("Property") || temp_obj.type_name.contains("Function") || temp_obj.type_name.contains("Enum")) && !temp_obj.full_name.contains("Core") {
                    for j in (self.offsets.fname_index..0x100).step_by(0x8) {
                        let mut member_entry_ptr = match process.memory.read_pointer(sub_object_entry.wrapping_add(j)) {
                            Ok(ptr) => ptr,
                            Err(_) => continue,
                        };

                        for k in 1..=check_level {
                            if let Some(member_obj) = object_manager.try_save_object(member_entry_ptr, process, name_pool, &self.offsets, 0, 5, true) {
                                if (!member_obj.type_name.contains("Property") && !member_obj.type_name.contains("Function") && !member_obj.type_name.contains("ScriptStruct") && !member_obj.type_name.contains("State")) || member_obj.full_name.contains("Core") {
                                    break;
                                }

                                if self.offsets.member_fname_index == 0x20 || self.offsets.member_fname_index == 0 {
                                    for n in (self.offsets.fname_index + 0x8..=0x50).step_by(0x8) {
                                        if let Ok(temp_fname_id) = process.memory.read::<u32>(member_entry_ptr.wrapping_add(n)) {
                                            if let Ok(name_str) = name_pool.get_name(process, temp_fname_id) {
                                                if let Ok(number) = process.memory.read::<u32>(member_entry_ptr.wrapping_add(n.wrapping_add(4))) {
                                                    if number == 0 && !name_str.is_empty() {
                                                        self.offsets.member_fname_index = n;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                let temp_fname_id = process.memory.read::<u32>(member_entry_ptr.wrapping_add(self.offsets.member_fname_index)).unwrap_or(0);
                                let name_str = name_pool.get_name(process, temp_fname_id).unwrap_or_default();
                                if name_str.is_empty() {
                                    break;
                                }

                                if k == check_level {
                                    self.offsets.next_member = j;
                                    self.offsets.member = i;
                                    found_next_member = true;
                                    break;
                                }

                                if let Ok(next_ptr) = process.memory.read_pointer(member_entry_ptr.wrapping_add(j)) {
                                    member_entry_ptr = next_ptr;
                                } else {
                                    break;
                                }
                            } else {
                                break;
                            }
                        }

                        if found_next_member {
                            break;
                        }
                    }
                }

                if found_super && found_next_member {
                    break;
                }
            }
        }

        if engine_or_actor_address == 0 {
            return Err("Failed to find Super Address (Engine or Actor)".to_string());
        }

        Ok(engine_or_actor_address)
    }

    fn get_type_size(type_name: &str) -> u32 {
        if type_name.contains("ObjectProperty") || type_name.contains("ClassProperty") {
            8
        } else if type_name.contains("FloatProperty") || type_name.contains("IntProperty") {
            4
        } else if type_name.contains("BoolProperty") || type_name.contains("ByteProperty") {
            1
        } else {
            0
        }
    }

    pub fn find_property_size_offset(&mut self, process: &Process, name_pool: &FNamePool, object_manager: &ObjectManager, engine_or_actor_address: usize) {
        let mut member_entry = match process.memory.read_pointer(engine_or_actor_address.wrapping_add(self.offsets.member)) {
            Ok(ptr) => ptr,
            Err(_) => return,
        };

        let mut found_obj = false;
        let mut target_type_size = 0;

        for _ in 0..=300 {
            if let Some(temp_obj) = object_manager.try_save_object(member_entry, process, name_pool, &self.offsets, 0, 5, true) {
                if temp_obj.type_name.contains("ObjectProperty") {
                    found_obj = true;
                    target_type_size = Self::get_type_size(&temp_obj.type_name);
                    break;
                }
            }
            if let Ok(next_ptr) = process.memory.read_pointer(member_entry.wrapping_add(self.offsets.next_member)) {
                member_entry = next_ptr;
            } else {
                break;
            }
        }

        if !found_obj || target_type_size == 0 {
            return;
        }

        let search_start = member_entry.wrapping_add(self.offsets.outer).wrapping_add(0x8);
        if let Some(prop_size_address) = Self::scan_memory_for_int(process, search_start, 0x100, target_type_size, None, 2) {
            self.offsets.prop_size = prop_size_address - member_entry;
        }
    }

    pub fn find_offset_offset(&mut self, process: &Process, name_pool: &FNamePool, object_manager: &ObjectManager, engine_or_actor_address: usize) {
        let mut member_entry = match process.memory.read_pointer(engine_or_actor_address.wrapping_add(self.offsets.member)) {
            Ok(ptr) => ptr,
            Err(_) => return,
        };

        let mut found_obj = false;
        let mut target_type_size = 0;

        for _ in 0..=300 {
            if let Some(temp_obj) = object_manager.try_save_object(member_entry, process, name_pool, &self.offsets, 0, 5, true) {
                if temp_obj.type_name.contains("ObjectProperty") || temp_obj.type_name.contains("ClassProperty") || temp_obj.type_name.contains("FloatProperty") || temp_obj.type_name.contains("IntProperty") {
                    found_obj = true;
                    target_type_size = Self::get_type_size(&temp_obj.type_name);
                    break;
                }
            }
            if let Ok(next_ptr) = process.memory.read_pointer(member_entry.wrapping_add(self.offsets.next_member)) {
                member_entry = next_ptr;
            } else {
                break;
            }
        }

        if !found_obj {
            return;
        }

        let next_member_entry = match process.memory.read_pointer(member_entry.wrapping_add(self.offsets.next_member)) {
            Ok(ptr) => ptr,
            Err(_) => return,
        };

        for i in (self.offsets.next_member + 0x8..=0x100).step_by(2) {
            if let Ok(temp_int_1) = process.memory.read::<u16>(member_entry.wrapping_add(i)) {
                if let Ok(temp_int_2) = process.memory.read::<u16>(next_member_entry.wrapping_add(i)) {
                    let next_val_expected = (temp_int_1 as u32) + target_type_size;
                    if next_val_expected >= 0x20 && next_val_expected == (temp_int_2 as u32) {
                        self.offsets.offset = i;
                        break;
                    }
                }
            }
        }
    }

    pub fn find_bit_mask_offset(&mut self, process: &Process, name_pool: &FNamePool, object_manager: &ObjectManager, actor_address: usize) {
        let mut member_entry = match process.memory.read_pointer(actor_address.wrapping_add(self.offsets.member)) {
            Ok(ptr) => ptr,
            Err(_) => return,
        };

        let mut found_obj = false;
        let mut next_member_entry = 0;

        for _ in 0..=300 {
            if let Some(temp_obj) = object_manager.try_save_object(member_entry, process, name_pool, &self.offsets, 0, 5, true) {
                if temp_obj.type_name.contains("BoolProperty") {
                    if let Ok(next) = process.memory.read_pointer(member_entry.wrapping_add(self.offsets.next_member)) {
                        next_member_entry = next;

                        if let Ok(temp_int_1) = process.memory.read::<u16>(member_entry.wrapping_add(self.offsets.offset)) {
                            if let Ok(temp_int_2) = process.memory.read::<u16>(next_member_entry.wrapping_add(self.offsets.offset)) {
                                if temp_int_1 == temp_int_2 {
                                    found_obj = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if let Ok(next) = process.memory.read_pointer(member_entry.wrapping_add(self.offsets.next_member)) {
                member_entry = next;
            } else {
                break;
            }
        }

        if !found_obj {
            return;
        }

        for i in 0x70..=0x100 {
            if let Ok(byte_1) = process.memory.read::<u8>(member_entry.wrapping_add(i)) {
                if let Ok(byte_2) = process.memory.read::<u8>(next_member_entry.wrapping_add(i)) {
                    if byte_1 == 1 && byte_2 % 2 == 0 && byte_1 < byte_2 {
                        self.offsets.bit_mask = i;
                        break;
                    }
                }
            }
        }
    }

    /// Simplified translation of AutoConfig.cpp dynamically scanning UObject memory structure
    pub fn scan_basic_offsets(&mut self, process: &Process, name_pool: &FNamePool, object_manager: &ObjectManager, gu_object_base: usize, element_size: usize) -> Result<(), String> {
        self.find_basic_info_offset(process, name_pool, gu_object_base, element_size)?;

        // Find GameEngine or Pawn
        let mut actor_engine_address = 0;
        let object_array_entry = process.memory.read_pointer(gu_object_base.wrapping_add(0x10)).map_err(|e| format!("Failed to read GUObjectArray entry: {}", e))?;

        for i in 0..=5000 {
            // Fallback basic search for an Actor or GameEngine
            let chunk_ptr = process.memory.read_pointer(object_array_entry.wrapping_add((i / 65536) * 8)).unwrap_or(0);
            if chunk_ptr == 0 {
                continue;
            }
            let object_entry = process.memory.read_pointer(chunk_ptr.wrapping_add((i % 65536) * element_size)).unwrap_or(0);
            if object_entry == 0 {
                continue;
            }

            if let Some(obj) = object_manager.try_save_object(object_entry, process, name_pool, &self.offsets, 0, 5, true) {
                if obj.full_name.contains("Engine.GameEngine") || obj.full_name.contains("Engine.Pawn") {
                    actor_engine_address = object_entry;
                    break;
                }
            }
        }

        if actor_engine_address != 0 {
            if let Ok(super_address) = self.find_super_and_member_offset(process, name_pool, object_manager, actor_engine_address) {
                self.find_property_size_offset(process, name_pool, object_manager, super_address);
                self.find_offset_offset(process, name_pool, object_manager, super_address);
                self.find_bit_mask_offset(process, name_pool, object_manager, super_address);
            }
        }

        println!(
            "[AutoConfig] Discovered Base Offsets:\nID: {:X}, Class: {:X}, FNameIndex: {:X}, Outer: {:X}\nSuper: {:X}, Member: {:X}, NextMember: {:X}, MemberFNameIndex: {:X}\nOffset: {:X}, PropSize: {:X}, BitMask: {:X}",
            self.offsets.id, self.offsets.class, self.offsets.fname_index, self.offsets.outer, self.offsets.super_struct, self.offsets.member, self.offsets.next_member, self.offsets.member_fname_index, self.offsets.offset, self.offsets.prop_size, self.offsets.bit_mask
        );

        Ok(())
    }
}
