use crate::backend::os::process::Process;
use crate::backend::unreal::autoconfig::AutoConfig;
use std::sync::Mutex;

/// The global application state for the memory scanner
pub struct AppState {
    pub process: Mutex<Option<Process>>,
    pub auto_config: Mutex<Option<AutoConfig>>,
}

// Ensure AppState is Send + Sync for Tauri
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

impl AppState {
    pub fn new() -> Self {
        Self { process: Mutex::new(None), auto_config: Mutex::new(None) }
    }
}
