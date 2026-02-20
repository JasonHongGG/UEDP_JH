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
