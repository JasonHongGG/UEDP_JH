pub mod analyzer;
pub mod api;
pub mod base_address;
pub mod inspector;
pub mod instance;
pub mod package;
pub mod parser;
pub mod process;
pub mod search;

pub fn get_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![
        process::fetch_system_processes,
        process::attach_to_process,
        base_address::get_ue_version,
        base_address::get_fname_pool_address,
        base_address::get_guobject_array_address,
        base_address::get_gworld_address,
        base_address::show_base_address,
        parser::parse_fname_pool,
        parser::parse_guobject_array,
        package::get_packages,
        package::get_objects,
        inspector::get_object_details,
        search::global_search,
        search::search_object_instances,
        search::search_object_references,
        search::get_object_address_by_id,
        instance::add_inspector,
        instance::get_instance_details,
        instance::get_array_elements,
        instance::write_instance_property,
        analyzer::analyze_fname,
        analyzer::analyze_object,
        api::start_api_server,
        api::sync_api_config,
        api::fetch_api_live_values,
    ]
}
