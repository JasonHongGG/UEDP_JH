use crate::backend::os::process::Process;

pub struct FNamePool {
    base_address: usize,
}

impl FNamePool {
    pub fn new(base_address: usize) -> Self {
        Self { base_address }
    }

    /// Read FName from the name pool using its ID
    pub fn get_name(&self, process: &Process, id: u32) -> Result<String, String> {
        let block = id >> 16;
        let offset = (id & 65535) as usize;

        let name_pool_chunk = process.memory.read_pointer(self.base_address + 0x10)?;
        let current_block_address = process.memory.read_pointer(name_pool_chunk + (block as usize) * 8)?;
        let name_entry_address = current_block_address + (offset * 2);

        // NameEntry string length is defined at name_entry_address (first 2 bytes usually represent size/flags in newer UE versions)
        let name_length = process.memory.read::<u16>(name_entry_address)? >> 6;

        if name_length > 0 && name_length < 255 {
            let name_str_address = name_entry_address + 2;
            process.memory.read_string(name_str_address, name_length as usize)
        } else {
            Err(format!("Invalid name length: {}", name_length))
        }
    }
}
