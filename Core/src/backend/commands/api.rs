use crate::backend::state::AppState;
use axum::{
    extract::State as AxumState,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct ApiServerState {
    pub app_handle: AppHandle,
}

#[derive(Deserialize)]
pub struct WriteRequest {
    pub instance: String,
    pub path: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct WriteResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn sync_api_config(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let state = app.state::<AppState>();
    if let Ok(mut lock) = state.api_config.lock() {
        *lock = Some(config);
    }
    Ok(())
}

#[tauri::command]
pub async fn start_api_server(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    let state = ApiServerState { app_handle: app.clone() };

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    let app_router = Router::new().route("/api/data", get(data_handler)).route("/api/write", post(write_handler)).layer(cors).with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => return Err(format!("Failed to bind to {}: {}", addr, e)),
    };

    println!("[API] Server listening on {}", addr);

    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, app_router).await {
            println!("[API] Server error: {}", e);
        }
    });

    Ok(())
}

fn insert_value_at_path(map: &mut serde_json::Map<String, Value>, path: &str, value: Value) {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = map;
    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            current.insert(part.to_string(), value.clone());
            break;
        }
        let next_val = current.entry(part.to_string()).or_insert_with(|| json!({}));
        current = next_val.as_object_mut().unwrap();
    }
}

fn read_primitive_value(proc: &crate::backend::os::process::Process, address: usize, property_type: &str) -> String {
    let t = property_type.to_lowercase();
    if t.contains("bool") {
        let val = proc.memory.try_read::<u8>(address).unwrap_or(0);
        if val > 0 {
            "True".into()
        } else {
            "False".into()
        }
    } else if t.contains("int8") {
        proc.memory.try_read::<i8>(address).unwrap_or(0).to_string()
    } else if t.contains("int16") {
        proc.memory.try_read::<i16>(address).unwrap_or(0).to_string()
    } else if t.contains("int") || t.contains("uint32") {
        proc.memory.try_read::<i32>(address).unwrap_or(0).to_string()
    } else if t.contains("float") {
        let val = proc.memory.try_read::<f32>(address).unwrap_or(0.0);
        format!("{:.3}", val)
    } else if t.contains("double") {
        let val = proc.memory.try_read::<f64>(address).unwrap_or(0.0);
        format!("{:.3}", val)
    } else {
        // Unknown or object pointer etc
        let ptr = proc.memory.try_read_pointer(address).unwrap_or(0);
        format!("0x{:X}", ptr)
    }
}

async fn data_handler(AxumState(state): AxumState<ApiServerState>) -> Json<Value> {
    let app_state = state.app_handle.state::<AppState>();

    let config_val = {
        let lock = match app_state.api_config.lock() {
            Ok(l) => l,
            Err(_) => return Json(json!({"error": "Failed to lock config"})),
        };
        match lock.as_ref() {
            Some(c) => c.clone(),
            None => return Json(json!({"error": "No API config synced"})),
        }
    };

    let mut response_map = serde_json::Map::new();

    let proc_guard = match app_state.process.lock() {
        Ok(l) => l,
        Err(_) => return Json(json!({"error": "Process lock failed"})),
    };
    let proc = match proc_guard.as_ref() {
        Some(p) => p,
        None => return Json(json!({"error": "Process not attached"})),
    };

    if let Some(groups) = config_val.as_object() {
        for (_id, group) in groups {
            let instance_name = group.get("instanceName").and_then(|v| v.as_str()).unwrap_or("Unknown");
            let instance_addr_str = group.get("instanceAddress").and_then(|v| v.as_str()).unwrap_or("N/A");

            let mut instance_data = serde_json::Map::new();
            instance_data.insert("instanceAddress".into(), json!(instance_addr_str));
            let mut properties_tree = serde_json::Map::new();

            if let Some(data_array) = group.get("data").and_then(|v| v.as_array()) {
                for class_data in data_array {
                    if let Some(params) = class_data.get("parameters").and_then(|v| v.as_array()) {
                        for param in params {
                            let prop_name = param.get("property_name").and_then(|v| v.as_str()).unwrap_or("");
                            let full_path = param.get("full_path").and_then(|v| v.as_str()).unwrap_or(prop_name);
                            let prop_type = param.get("property_type").and_then(|v| v.as_str()).unwrap_or("");
                            let memory_address_str = param.get("memory_address").and_then(|v| v.as_str()).unwrap_or("0");

                            let addr_result = usize::from_str_radix(memory_address_str.trim_start_matches("0x"), 16);
                            if let Ok(addr) = addr_result {
                                if addr > 0x10000 {
                                    let val_str = read_primitive_value(&proc, addr, prop_type);
                                    let mut actual_val: Value = json!(val_str);

                                    let tlower = prop_type.to_lowercase();
                                    if tlower.contains("int") || tlower.contains("float") || tlower.contains("double") {
                                        if let Ok(num) = val_str.parse::<f64>() {
                                            actual_val = json!(num);
                                        }
                                    } else if tlower.contains("bool") {
                                        actual_val = json!(val_str.to_lowercase() == "true");
                                    }

                                    insert_value_at_path(&mut properties_tree, full_path, actual_val);
                                } else {
                                    insert_value_at_path(&mut properties_tree, full_path, json!("Invalid Address"));
                                }
                            }
                        }
                    }
                }
            }

            instance_data.insert("properties".into(), json!(properties_tree));
            response_map.insert(instance_name.to_string(), json!(instance_data));
        }
    }

    Json(json!(response_map))
}

async fn write_handler(AxumState(state): AxumState<ApiServerState>, Json(payload): Json<WriteRequest>) -> Json<WriteResponse> {
    let app_state = state.app_handle.state::<AppState>();

    let config_val = {
        let lock = match app_state.api_config.lock() {
            Ok(l) => l,
            Err(_) => return Json(WriteResponse { success: false, error: Some("Failed to lock config".into()) }),
        };
        match lock.as_ref() {
            Some(c) => c.clone(),
            None => return Json(WriteResponse { success: false, error: Some("No API config synced".into()) }),
        }
    };

    let target_instance = payload.instance;
    let target_path = payload.path;

    let mut found_address = String::new();
    let mut found_type = String::new();

    if let Some(groups) = config_val.as_object() {
        for (_id, group) in groups {
            let instance_name = group.get("instanceName").and_then(|v| v.as_str()).unwrap_or("");
            if instance_name == target_instance {
                if let Some(data_array) = group.get("data").and_then(|v| v.as_array()) {
                    for class_data in data_array {
                        if let Some(params) = class_data.get("parameters").and_then(|v| v.as_array()) {
                            for param in params {
                                let fpath = param.get("full_path").and_then(|v| v.as_str()).unwrap_or("");
                                if fpath == target_path {
                                    found_address = param.get("memory_address").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    found_type = param.get("property_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    break;
                                }
                            }
                        }
                        if !found_address.is_empty() {
                            break;
                        }
                    }
                }
            }
            if !found_address.is_empty() {
                break;
            }
        }
    }

    if found_address.is_empty() || found_address == "0" || found_address == "0x0" {
        return Json(WriteResponse { success: false, error: Some("Parameter not tracked or invalid memory address".into()) });
    }

    // Since found_address is the absolute memory address already computed by the UI, we specify "0" offset for write_instance_property
    let res = crate::backend::commands::instance::write_instance_property(app_state, found_address, "0".to_string(), found_type, payload.value).await;

    match res {
        Ok(_) => Json(WriteResponse { success: true, error: None }),
        Err(e) => Json(WriteResponse { success: false, error: Some(e) }),
    }
}
