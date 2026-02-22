use crate::backend::os::process::Process;
use crate::backend::unreal::autoconfig::AutoConfig;
use crate::backend::unreal::name_pool::FNamePool;
use crate::backend::unreal::object_array::ObjectManager;
use std::sync::{Arc, Mutex};

/// Cached base addresses resolved by BaseAddressDumper.
/// These are populated by commands in `base_address.rs` and consumed by other modules.
#[derive(Default)]
pub struct BaseAddresses {
    pub fname_pool: Option<usize>,
    pub guobject_array: Option<usize>,
    pub guobject_element_size: Option<usize>,
    pub gworld: Option<usize>,
}

/// The global application state for the memory scanner
pub struct AppState {
    pub process: Mutex<Option<Process>>,
    pub auto_config: Mutex<Option<AutoConfig>>,
    pub object_manager: Arc<ObjectManager>,
    pub name_pool: Mutex<Option<Arc<FNamePool>>>,
    /// Resolved base addresses — written by `base_address` commands, read by all others.
    pub base_addresses: Mutex<BaseAddresses>,
}

// Ensure AppState is Send + Sync for Tauri
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

impl AppState {
    pub fn new() -> Self {
        Self { process: Mutex::new(None), auto_config: Mutex::new(None), object_manager: Arc::new(ObjectManager::new()), name_pool: Mutex::new(None), base_addresses: Mutex::new(BaseAddresses::default()) }
    }
}
