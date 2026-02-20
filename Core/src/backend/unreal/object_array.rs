use crate::backend::os::process::Process;
use crate::backend::unreal::types::UObject;

pub struct GUObjectArray {
    base_address: usize,
}

impl GUObjectArray {
    pub fn new(base_address: usize) -> Self {
        Self { base_address }
    }

    /// Read UObject fields from the Object Array given its ID
    pub fn get_object(&self, process: &Process, id: u32) -> Result<UObject, String> {
        // Find chunk index and offset
        // Usually, in UE4/UE5, Objects are stored in 64K chunks or directly if chunked array is not fully utilized
        // Formula often: chunk_index = id / 65536, item_index = id % 65536
        // Element size is typically 24 bytes (0x18)
        let element_size = 0x18;

        // This is a simplified direct reading implementation, assuming older UE4 flat array or early chunked array
        // Read Objects array pointer (offset 0x10 or 0x18 depending on UE version, usually 0x10)
        let objects_ptr = process.memory.read_pointer(self.base_address + 0x10)?;

        let chunk_index = id / 65536;
        let item_index = id % 65536;

        let chunk_ptr = process.memory.read_pointer(objects_ptr + (chunk_index as usize * 8))?;
        let item_address = chunk_ptr + ((item_index as usize) * element_size);

        // The actual UObject address is the first pointer in the FUObjectItem
        let object_address = process.memory.read_pointer(item_address)?;

        if object_address == 0 {
            return Err(format!("Object address for id {} is null", id));
        }

        // We assume UObject offsets are standard (Needs AutoConfig to properly resolve in real-world)
        // FName index: 0x18 (standard UE4+)
        // Outer Private: 0x20
        // Class Private: 0x10

        let class_address = process.memory.read_pointer(object_address + 0x10).unwrap_or(0);
        let outer_address = process.memory.read_pointer(object_address + 0x20).unwrap_or(0);
        let fname_index = process.memory.read::<u32>(object_address + 0x18).unwrap_or(0);

        Ok(UObject::new(object_address, id, fname_index, outer_address, class_address))
    }
}
