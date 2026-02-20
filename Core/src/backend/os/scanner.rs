use crate::backend::os::memory::Memory;
use rayon::prelude::*;
use std::ffi::c_void;
use windows::Win32::System::Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_GUARD, PAGE_NOACCESS};

pub struct Scanner;

impl Scanner {
    /// Convert an AOB string like "48 8D 05 ? ? ? ? 48 89" into an array of optional bytes
    pub fn parse_signature(signature: &str) -> Vec<Option<u8>> {
        signature.split_whitespace().map(|s| if s == "?" || s == "??" { None } else { u8::from_str_radix(s, 16).ok() }).collect()
    }

    /// Search for a byte pattern within a specific buffer. Highly optimized raw loop for max speed in both Dev and Release.
    pub fn find_pattern_in_buffer(buffer: &[u8], pattern: &[Option<u8>]) -> Vec<usize> {
        let mut matches = Vec::new();
        if pattern.is_empty() || buffer.len() < pattern.len() {
            return matches;
        }

        let first_byte = pattern[0];
        let mut i = 0;
        let end = buffer.len() - pattern.len();

        while i <= end {
            // Fast skip finding the first byte
            if let Some(b) = first_byte {
                let mut found = false;
                while i <= end {
                    if buffer[i] == b {
                        found = true;
                        break;
                    }
                    i += 1;
                }
                if !found {
                    break;
                }
            }

            // Check the rest of the pattern
            let mut matched = true;
            for j in 1..pattern.len() {
                if let Some(p) = pattern[j] {
                    if buffer[i + j] != p {
                        matched = false;
                        break;
                    }
                }
            }

            if matched {
                matches.push(i);
            }
            i += 1;
        }

        matches
    }

    /// Scan a process's memory range for a given pattern
    pub fn scan(memory: &Memory, start_address: usize, end_address: usize, signature: &str) -> Result<Vec<usize>, String> {
        let pattern = Self::parse_signature(signature);
        if pattern.is_empty() {
            return Err("Invalid signature".to_string());
        }

        let mut current_address = start_address;
        let mut regions: Vec<(usize, usize)> = Vec::new();

        // Enumerate memory regions
        while current_address < end_address {
            let mut mem_info = MEMORY_BASIC_INFORMATION::default();

            let result = unsafe {
                VirtualQueryEx(
                    memory.handle(), // We need to expose memory handle or let Memory do this
                    Some(current_address as *const c_void),
                    &mut mem_info,
                    std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
                )
            };

            if result == 0 {
                break;
            }

            // Check if memory is committed and readable
            // MEM_COMMIT = 0x1000, PAGE_NOACCESS = 0x01, PAGE_GUARD = 0x100
            if mem_info.State == MEM_COMMIT && (mem_info.Protect.0 & PAGE_NOACCESS.0) == 0 && (mem_info.Protect.0 & PAGE_GUARD.0) == 0 {
                let region_size = mem_info.RegionSize as usize;
                regions.push((current_address, region_size));
            }

            current_address += mem_info.RegionSize as usize;
        }

        // Search each valid region in parallel
        let results: Vec<usize> = regions
            .into_par_iter()
            .flat_map(|(base, size)| {
                // Read the entire region
                if let Ok(buffer) = memory.read_bytes(base, size) {
                    // Search block for pattern
                    Self::find_pattern_in_buffer(&buffer, &pattern).into_iter().map(move |offset| base + offset).collect::<Vec<usize>>()
                } else {
                    Vec::new()
                }
            })
            .collect();

        Ok(results)
    }
}
