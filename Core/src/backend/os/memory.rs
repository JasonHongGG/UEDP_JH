use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;

#[derive(Debug)]
pub struct Memory {
    handle: HANDLE,
}

// Win32 process handles used for memory reading are thread-safe and can be shared across threads.
unsafe impl Send for Memory {}
unsafe impl Sync for Memory {}

impl Memory {
    pub fn new(handle: HANDLE) -> Self {
        Self { handle }
    }

    /// Exposes the inner OS handle for specific Win32 API calls like VirtualQueryEx
    pub fn handle(&self) -> HANDLE {
        self.handle
    }

    /// Read raw bytes from the process memory
    pub fn read_bytes(&self, address: usize, size: usize) -> Result<Vec<u8>, String> {
        let mut buffer = vec![0u8; size];
        let mut bytes_read = 0;

        let success = unsafe { ReadProcessMemory(self.handle, address as *const c_void, buffer.as_mut_ptr() as *mut c_void, size, Some(&mut bytes_read)) };

        if success.is_ok() && bytes_read > 0 {
            Ok(buffer)
        } else {
            Err(format!("Failed to read memory at 0x{:X}", address))
        }
    }

    /// Read a specific type from memory
    pub fn read<T: Copy>(&self, address: usize) -> Result<T, String> {
        self.try_read::<T>(address).ok_or_else(|| format!("Failed to read generic type at 0x{:X}", address))
    }

    /// Fast-path read: returns Option instead of allocating error strings.
    /// Use this in hot loops where millions of reads may fail.
    #[inline]
    pub fn try_read<T: Copy>(&self, address: usize) -> Option<T> {
        let size = std::mem::size_of::<T>();
        let mut buffer = std::mem::MaybeUninit::<T>::uninit();
        let mut bytes_read = 0;

        let success = unsafe { ReadProcessMemory(self.handle, address as *const c_void, buffer.as_mut_ptr() as *mut c_void, size, Some(&mut bytes_read)) };

        if success.is_ok() && bytes_read == size {
            Some(unsafe { buffer.assume_init() })
        } else {
            None
        }
    }

    /// Read a pointer address (64-bit)
    pub fn read_pointer(&self, address: usize) -> Result<usize, String> {
        self.read::<u64>(address).map(|v| v as usize)
    }

    /// Fast-path read pointer: returns Option, zero allocation on failure.
    #[inline]
    pub fn try_read_pointer(&self, address: usize) -> Option<usize> {
        self.try_read::<u64>(address).map(|v| v as usize)
    }

    /// Get the size of the memory region at the given address using VirtualQueryEx
    pub fn get_memory_region_size(&self, address: usize) -> Result<usize, String> {
        use windows::Win32::System::Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION};

        let mut mbi = MEMORY_BASIC_INFORMATION::default();
        let result = unsafe { VirtualQueryEx(self.handle, Some(address as *const c_void), &mut mbi, std::mem::size_of::<MEMORY_BASIC_INFORMATION>()) };

        if result == 0 {
            Err(format!("VirtualQueryEx failed at 0x{:X}", address))
        } else {
            Ok(mbi.RegionSize)
        }
    }

    /// Read a null-terminated UTF-8 string or ASCII string
    pub fn read_string(&self, address: usize, max_length: usize) -> Result<String, String> {
        let mut result = String::new();
        let mut current_addr = address;
        let mut count = 0;

        loop {
            if count >= max_length {
                break;
            }

            match self.read::<u8>(current_addr) {
                Ok(byte) => {
                    if byte == 0 {
                        break;
                    }
                    result.push(byte as char);
                    current_addr += 1;
                    count += 1;
                }
                Err(e) => return Err(e),
            }
        }

        Ok(result)
    }
}

impl Drop for Memory {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }
}
