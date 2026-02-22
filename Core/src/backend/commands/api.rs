use crate::backend::state::AppState;
use axum::{
    extract::{Query, State as AxumState},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;
use tauri::{AppHandle, Manager};
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct ApiServerState {
    pub app_handle: AppHandle,
}

#[derive(Deserialize)]
pub struct LocateQuery {
    pub class_address: String,
    pub instance_name: String,
}

#[derive(Serialize)]
pub struct LocateResponse {
    pub instance_address: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct WriteRequest {
    pub address: String,
    pub offset: String,
    pub property_type: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct WriteResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn start_api_server(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    let state = ApiServerState { app_handle: app.clone() };

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app_router = Router::new().route("/api/locate", get(locate_handler)).route("/api/write", post(write_handler)).layer(cors).with_state(state);

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

async fn locate_handler(AxumState(state): AxumState<ApiServerState>, Query(params): Query<LocateQuery>) -> Json<LocateResponse> {
    let app_state = state.app_handle.state::<AppState>();

    let class_addr_res = usize::from_str_radix(params.class_address.trim_start_matches("0x"), 16);
    if class_addr_res.is_err() {
        return Json(LocateResponse { instance_address: None, error: Some("Invalid class_address".to_string()) });
    }
    let class_addr = class_addr_res.unwrap();

    let signature = class_addr.to_le_bytes().iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");

    let process_lock = match app_state.process.lock() {
        Ok(l) => l,
        Err(_) => return Json(LocateResponse { instance_address: None, error: Some("Process lock failed".to_string()) }),
    };
    let proc = match process_lock.as_ref() {
        Some(p) => p,
        None => return Json(LocateResponse { instance_address: None, error: Some("Process not attached".to_string()) }),
    };

    let hits = match crate::backend::os::scanner::Scanner::scan(&proc.memory, 0x0, 0x7FFFFFFFFFFF, &signature) {
        Ok(h) => h,
        Err(e) => return Json(LocateResponse { instance_address: None, error: Some(format!("Scan failed: {}", e)) }),
    };

    let obj_mgr = &app_state.object_manager;
    let name_pool_guard = match app_state.name_pool.lock() {
        Ok(g) => g,
        Err(_) => return Json(LocateResponse { instance_address: None, error: Some("Name pool lock failed".to_string()) }),
    };
    let name_pool = match name_pool_guard.as_ref() {
        Some(pool) => pool,
        None => return Json(LocateResponse { instance_address: None, error: Some("Name pool not valid".to_string()) }),
    };

    let offsets = crate::backend::unreal::offsets::UEOffset::default();
    let target_name = params.instance_name.to_lowercase();

    for hit in hits {
        let instance_addr = hit.saturating_sub(0x10);
        if let Some(obj_data) = obj_mgr.try_save_object(instance_addr, proc, name_pool, &offsets, 0, 5) {
            if obj_data.name.to_lowercase() == target_name {
                return Json(LocateResponse { instance_address: Some(format!("0x{:X}", instance_addr)), error: None });
            }
        }
    }

    Json(LocateResponse { instance_address: None, error: Some("Instance not found".to_string()) })
}

async fn write_handler(AxumState(state): AxumState<ApiServerState>, Json(payload): Json<WriteRequest>) -> Json<WriteResponse> {
    let app_state = state.app_handle.state::<AppState>();

    let res = crate::backend::commands::instance::write_instance_property(app_state, payload.address, payload.offset, payload.property_type, payload.value).await;

    match res {
        Ok(_) => Json(WriteResponse { success: true, error: None }),
        Err(e) => Json(WriteResponse { success: false, error: Some(e) }),
    }
}
