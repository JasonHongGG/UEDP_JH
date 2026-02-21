use crate::backend::os::process::Process;
use crate::backend::unreal::autoconfig::AutoConfig;
use crate::backend::unreal::name_pool::FNamePool;
use crate::backend::unreal::object_array::ObjectManager;
use std::sync::{Arc, Mutex};

/// The global application state for the memory scanner
pub struct AppState {
    pub process: Mutex<Option<Process>>,
    pub auto_config: Mutex<Option<AutoConfig>>,
    pub object_manager: Arc<ObjectManager>,
    pub name_pool: Mutex<Option<Arc<FNamePool>>>,
}

// Ensure AppState is Send + Sync for Tauri
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

impl AppState {
    pub fn new() -> Self {
        Self { process: Mutex::new(None), auto_config: Mutex::new(None), object_manager: Arc::new(ObjectManager::new()), name_pool: Mutex::new(None) }
    }
}
