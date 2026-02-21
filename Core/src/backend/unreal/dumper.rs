use crate::backend::os::process::Process;
use crate::backend::os::scanner::Scanner;

pub struct BaseAddressDumper;

impl BaseAddressDumper {
    /// Resolves a RIP-relative address using an instruction address, the offset of the 32-bit displacement, and the total instruction length.
    /// target_address = instruction_address + instruction_length + displacement
    pub fn resolve_rip(process: &Process, instr_addr: usize, disp_offset: usize, instr_len: usize) -> Result<usize, String> {
        // Read 32-bit signed displacement
        let disp: i32 = process.memory.read::<i32>(instr_addr + disp_offset)?;

        // Calculate absolute address
        // The cast to isize handles negative displacements properly when added to a usize base
        let target = (instr_addr + instr_len).wrapping_add_signed(disp as isize);

        Ok(target)
    }

    /// Attempts to find the FNamePool base address
    pub fn get_fname_pool(process: &Process) -> Result<usize, String> {
        let aobs = vec![
            // AOB, displacement_offset, instruction_length
            ("4C 8D 05 ? ? ? ? EB 16 48 8D 0D ? ? ? ? E8", 3, 7),
            ("48 8D 0D ? ? ? ? E8 ? ? ? ? ? 8B ? C6", 3, 7),
            ("48 83 EC 28 48 8B 05 ? ? ? ? 48 85 C0 75 ? B9 ? ? 00 00 48 89 5C 24 20 E8", 7, 11),
            ("C3 ? DB 48 89 1D ? ? ? ? ? ? 48 8B 5C 24 20", 6, 10),
            ("33 F6 89 35 ? ? ? ? 8B C6 5E", 4, 8),
            ("8B 07 8B 0D ? ? ? ? 8B 04 81", 4, 8),
        ];

        Self::scan_and_resolve(process, aobs, "FNamePool")
    }

    /// Attempts to find the GUObjectArray base address and element size
    /// Returns (base_address, element_size)
    pub fn get_guobject_array_with_element_size(process: &Process) -> Result<(usize, usize), String> {
        let base = Self::get_guobject_array(process)?;
        let element_size = Self::detect_element_size(process, base)?;
        println!("  -> GUObjectArray ElementSize = 0x{:X}", element_size);
        Ok((base, element_size))
    }

    /// Attempts to find the GUObjectArray base address
    pub fn get_guobject_array(process: &Process) -> Result<usize, String> {
        let aobs = vec![
            // AOB, displacement_offset, instruction_length
            ("44 8B ? ? ? 48 8D 05 ? ? ? ? ? ? ? ? ? 48 89 71 10", 8, 12),
            ("40 53 48 83 EC 20 48 8B D9 48 85 D2 74 ? 8B", 22, 26),
            ("4C 8B 05 ? ? ? ? 45 3B 88", 3, 7),
            ("4C 8B 44 24 60 8B 44 24 78 ? ? ? 48 8D", 15, 19),
            ("8B 44 24 04 56 8B F1 85 C0 74 17 8B 40 08", 16, 20),
            ("8B 15 ? ? ? ? 8B 04 82 85", 2, 6),
            ("56 48 83 ? ? 48 89 ? ? ? 48 89 ? 48 8D", 16, 20),
        ];

        Self::scan_and_resolve(process, aobs, "GUObjectArray")
    }

    /// Detect GUObjectArray element size by probing, matching C++ ValidateGUObjectArray logic.
    /// Iterates byte offsets from the base, reads the first valid chunk pointer,
    /// then probes element sizes k=0x4..0x1C to find which one produces consistent object indices.
    fn detect_element_size(process: &Process, base_address: usize) -> Result<usize, String> {
        // Scan offsets -0x50..0x200 from base to find a valid multi-level pointer entry
        for i_raw in (-0x50i32..=0x200).step_by(4) {
            let entry_addr = base_address.wrapping_add(i_raw as usize);

            // Try to read multi-level pointer (at least 4 levels deep)
            let ptr = match process.memory.read_pointer(entry_addr) {
                Ok(p) if p > 0x10000 => p,
                _ => continue,
            };

            // Check it's a deep pointer (can dereference 4 times)
            let mut valid_depth = true;
            let mut test_ptr = ptr;
            for _ in 0..3 {
                match process.memory.read_pointer(test_ptr) {
                    Ok(p) if p > 0x10000 => test_ptr = p,
                    _ => {
                        valid_depth = false;
                        break;
                    }
                }
            }
            if !valid_depth {
                continue;
            }

            // For up to 2 dereference levels (j = 0, 1), try element sizes k = 0x4..0x1C
            let mut addr_level_0 = ptr;
            for _j in 0..2 {
                for k in (0x4..=0x1C).step_by(4) {
                    let mut all_valid = true;
                    let max_n = 10 * k;

                    for n in (0..=max_n).step_by(k) {
                        // Read object entry at addr_level_0 + n
                        let obj_addr = match process.memory.read_pointer(addr_level_0.wrapping_add(n)) {
                            Ok(a) if a > 0x10000 => a,
                            _ => {
                                all_valid = false;
                                break;
                            }
                        };

                        // Validate: can dereference 3 times
                        let mut tp = obj_addr;
                        let mut ok = true;
                        for _ in 0..2 {
                            match process.memory.read_pointer(tp) {
                                Ok(p) if p > 0x10000 => tp = p,
                                _ => {
                                    ok = false;
                                    break;
                                }
                            }
                        }
                        if !ok {
                            all_valid = false;
                            break;
                        }

                        // Check that object index (at offset ~0x50 area) matches expected n/k
                        let expected_index = n / k;
                        let read_index = process.memory.read::<i32>(obj_addr.wrapping_add(0xC)).unwrap_or(-1);
                        if read_index < 0 || (read_index as usize).abs_diff(expected_index) > 2 {
                            all_valid = false;
                            break;
                        }
                    }

                    if all_valid {
                        println!("[ GUObjArr Entry ][ i ] {:X} \t[ Array Group Offset ][ k ] 0x{:X}", i_raw, k);
                        return Ok(k);
                    }
                }

                // Try one more dereference level
                match process.memory.read_pointer(addr_level_0) {
                    Ok(p) if p > 0x10000 => addr_level_0 = p,
                    _ => break,
                }
            }
        }

        // Fallback: default to 0x18 (most common for UE4 64-bit)
        println!("[ GUObjectArray ] Could not auto-detect element size, defaulting to 0x18");
        Ok(0x18)
    }

    /// Attempts to find the GWorld base address
    pub fn get_gworld(process: &Process) -> Result<usize, String> {
        let aobs = vec![("48 8B 1D ? ? ? ? 48 85 DB 74 33 41 B0 01", 3, 7)];

        Self::scan_and_resolve(process, aobs, "GWorld")
    }

    /// Generic scanner that goes through a list of (AOB, disp_offset, instr_len),
    /// scans the main module, and resolves the RIP relative pointer to find the global address.
    fn scan_and_resolve(process: &Process, aobs: Vec<(&str, usize, usize)>, target_name: &str) -> Result<usize, String> {
        for (idx, (aob, disp_offset, instr_len)) in aobs.iter().enumerate() {
            println!("Scanning for {} (AOB {})...", target_name, idx);
            match Scanner::scan(&process.memory, process.main_module_base, process.main_module_base + process.main_module_size, aob) {
                Ok(results) => {
                    if results.is_empty() {
                        println!("  -> AOB {} failed: Signature not found in memory.", idx);
                        continue;
                    }

                    for &addr in &results {
                        match Self::resolve_rip(process, addr, *disp_offset, *instr_len) {
                            Ok(resolved) => {
                                // Quick heuristic to validate if it's a valid pointer within user space
                                if resolved > 0x10000 && resolved < 0x7FFFFFFFFFFF {
                                    println!("  -> Found {} at 0x{:X} [{}]", target_name, resolved, aob);
                                    return Ok(resolved);
                                } else {
                                    println!("  -> AOB {} failed at 0x{:X}: Resolved address (0x{:X}) is out of valid user-space memory bounds.", idx, addr, resolved);
                                }
                            }
                            Err(e) => {
                                println!("  -> AOB {} failed at 0x{:X}: Could not read displacement. Error: {}", idx, addr, e);
                            }
                        }
                    }
                }
                Err(e) => {
                    println!("  -> AOB {} failed during scanning pipeline: {}", idx, e);
                }
            }
        }

        Err(format!("Could not find {} with any of the known AOB signatures", target_name))
    }
}
