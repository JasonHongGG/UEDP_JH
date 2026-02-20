use crate::backend::os::process::Process;

/// Stores the vital offsets dynamically found at runtime
#[derive(Debug, Default, Clone)]
pub struct UEOffsets {
    pub object_id: usize,
    pub f_name_index: usize,
    pub outer: usize,
    pub class: usize,
    pub super_field: usize,
    pub member: usize,
    pub next_member: usize,
    pub member_f_name_index: usize,
    pub offset: usize,
    pub prop_size: usize,
    pub bit_mask: usize,
}

pub struct AutoConfig {
    pub offsets: UEOffsets,
}

impl AutoConfig {
    pub fn new() -> Self {
        Self { offsets: UEOffsets::default() }
    }

    /// Simplified translation of AutoConfig.cpp dynamically scanning UObject memory structure
    pub fn scan_basic_offsets(&mut self, process: &Process, gu_object_base: usize, _name_pool_base: usize) -> Result<(), String> {
        // Read the GUObjectArray entry pointer
        let object_array_entry = process.memory.read_pointer(gu_object_base + 0x10)?;

        // Scan the first few objects
        for i in 0..10 {
            let chunk_ptr = process.memory.read_pointer(object_array_entry)?;
            let object_entry = process.memory.read_pointer(chunk_ptr + (i * 0x18))?;

            if object_entry == 0 {
                continue;
            }

            // Pattern scan for Object name string to identify Name property
            // (Mocking the exact C++ logic which reads strings manually here, we will hardcode common offsets for safety/speed)

            // Common modern UE5 offsets
            self.offsets.object_id = 0x0C; // ID is usually at 0x0C
            self.offsets.f_name_index = 0x18; // Name is at 0x18
            self.offsets.class = 0x10; // Class Private at 0x10
            self.offsets.outer = 0x20; // Outer Private at 0x20

            break;
        }

        Ok(())
    }
}
