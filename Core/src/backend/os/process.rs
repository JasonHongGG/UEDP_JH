use crate::backend::os::memory::Memory;
use crate::backend::state::AppState;
use std::collections::HashSet;
use sysinfo::System;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Module32First, MODULEENTRY32, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible};

#[derive(Debug, Clone)]
pub struct Process {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub memory: Memory,
    pub main_module_base: usize,
    pub main_module_size: usize,
}

#[derive(Debug, serde::Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

impl Process {
    /// Open/Attach to a process by its PID, creating a Memory reader for it and storing it in State
    pub fn attach(state: &tauri::State<'_, AppState>, pid: u32, name: &str) -> Result<String, String> {
        let handle = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid) }.map_err(|e| format!("Failed to open process PID {}: {}", pid, e))?;

        if handle.is_invalid() {
            return Err(format!("Invalid handle for PID {}", pid));
        }

        let mut sys = System::new_all();
        sys.refresh_processes();
        let exe_path = sys.process(sysinfo::Pid::from_u32(pid)).and_then(|p| p.exe()).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();

        let (main_module_base, main_module_size) = Self::get_main_module_info(pid)?;

        let process = Self { pid, name: name.to_string(), exe_path, memory: Memory::new(handle), main_module_base, main_module_size };

        let mut process_state = state.process.lock().unwrap();
        *process_state = Some(process);

        Ok(format!("Successfully attached to {}", name))
    }
    /// Enumerate all running application processes (filtered by visible windows)
    pub fn get_processes() -> Vec<ProcessInfo> {
        let mut app_pids = HashSet::new();
        struct EnumState<'a> {
            pids: &'a mut HashSet<u32>,
        }

        unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if IsWindowVisible(hwnd).as_bool() {
                let length = GetWindowTextLengthW(hwnd);
                if length > 0 {
                    let mut pid = 0;
                    GetWindowThreadProcessId(hwnd, Some(&mut pid));
                    if pid > 0 {
                        let state = &mut *(lparam.0 as *mut EnumState);
                        state.pids.insert(pid);
                    }
                }
            }
            BOOL(1)
        }

        let mut state = EnumState { pids: &mut app_pids };
        unsafe {
            let _ = EnumWindows(Some(enum_window), LPARAM(&mut state as *mut _ as isize));
        }

        let mut sys = System::new_all();
        sys.refresh_processes();

        let mut processes: Vec<ProcessInfo> = sys.processes().iter().filter(|(pid, _)| app_pids.contains(&pid.as_u32())).map(|(pid, process)| ProcessInfo { pid: pid.as_u32(), name: process.name().to_string() }).collect();

        // Sort alphabetically by name
        processes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        processes
    }

    /// Fetches the base address and size of the primary module for the given PID
    fn get_main_module_info(pid: u32) -> Result<(usize, usize), String> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid).map_err(|e| format!("Failed to create toolhelp snapshot: {}", e))?;

            if snapshot.is_invalid() {
                return Err("Invalid handle for toolhelp snapshot".to_string());
            }

            let mut module_entry = MODULEENTRY32 { dwSize: std::mem::size_of::<MODULEENTRY32>() as u32, ..Default::default() };

            if Module32First(snapshot, &mut module_entry).is_err() {
                windows::Win32::Foundation::CloseHandle(snapshot).ok();
                return Err("Failed to get first module".to_string());
            }

            // The first module returned by Module32First is always the main executable
            let base_address = module_entry.modBaseAddr as usize;
            let module_size = module_entry.modBaseSize as usize;

            windows::Win32::Foundation::CloseHandle(snapshot).ok();

            Ok((base_address, module_size))
        }
    }

    /// Fetches the Unreal Engine version by reading the VS_FIXEDFILEINFO of the executable.
    pub fn get_ue_version(&self) -> Result<String, String> {
        if self.exe_path.is_empty() {
            return Err("Executable path is unknown".to_string());
        }

        use std::ffi::c_void;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};

        unsafe {
            let path: Vec<u16> = std::ffi::OsStr::new(&self.exe_path).encode_wide().chain(std::iter::once(0)).collect();
            let pcwstr = PCWSTR::from_raw(path.as_ptr());

            let mut dummy = 0;
            let size = GetFileVersionInfoSizeW(pcwstr, Some(&mut dummy));
            if size == 0 {
                return Err("Failed to get version info size".to_string());
            }

            let mut buffer = vec![0u8; size as usize];
            if GetFileVersionInfoW(pcwstr, 0, size, buffer.as_mut_ptr() as *mut c_void).is_err() {
                return Err("Failed to get file version info".to_string());
            }

            let mut info_ptr = std::ptr::null_mut();
            let mut len = 0;
            let root = windows::core::w!("\\");
            if !VerQueryValueW(buffer.as_ptr() as *const c_void, root, &mut info_ptr, &mut len).as_bool() {
                return Err("Failed to query version info".to_string());
            }

            if info_ptr.is_null() || len == 0 {
                return Err("Invalid version info pointer".to_string());
            }

            let fixed_info = &*(info_ptr as *const VS_FIXEDFILEINFO);
            let major = fixed_info.dwFileVersionMS >> 16;
            let minor = fixed_info.dwFileVersionMS & 0xFFFF;
            let build = fixed_info.dwFileVersionLS >> 16;
            let revision = fixed_info.dwFileVersionLS & 0xFFFF;

            Ok(format!("{}.{}.{}.{}", major, minor, build, revision))
        }
    }
}
