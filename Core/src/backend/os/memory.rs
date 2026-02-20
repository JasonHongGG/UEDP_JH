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
        let size = std::mem::size_of::<T>();
        let mut buffer = std::mem::MaybeUninit::<T>::uninit();
        let mut bytes_read = 0;

        let success = unsafe { ReadProcessMemory(self.handle, address as *const c_void, buffer.as_mut_ptr() as *mut c_void, size, Some(&mut bytes_read)) };

        if success.is_ok() && bytes_read == size {
            Ok(unsafe { buffer.assume_init() })
        } else {
            Err(format!("Failed to read generic type at 0x{:X}", address))
        }
    }

    /// Read a pointer address (64-bit)
    pub fn read_pointer(&self, address: usize) -> Result<usize, String> {
        self.read::<u64>(address).map(|v| v as usize)
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
