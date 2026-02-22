use crate::backend::state::AppState;
use tauri::State;

#[derive(serde::Serialize)]
pub struct PackageInfo {
    pub name: String,
    pub object_count: usize,
}

pub fn extract_package_name(input: &str) -> String {
    let first_slash = match input.find('/') {
        Some(idx) => idx,
        None => return String::new(),
    };

    let second_slash = match input[first_slash + 1..].find('/') {
        Some(idx) => first_slash + 1 + idx,
        None => return String::new(),
    };

    if let Some(idx) = input[second_slash + 1..].find('/') {
        let third_slash = second_slash + 1 + idx;
        return input[first_slash..third_slash].to_string();
    }

    if let Some(idx) = input[second_slash + 1..].find('.') {
        let dot_pos = second_slash + 1 + idx;
        return input[first_slash..dot_pos].to_string();
    }

    if let Some(idx) = input[second_slash + 1..].find(':') {
        let colon_pos = second_slash + 1 + idx;
        return input[first_slash..colon_pos].to_string();
    }

    input[first_slash..].to_string()
}

#[tauri::command]
pub fn get_packages(state: State<'_, AppState>) -> Result<Vec<PackageInfo>, String> {
    let obj_mgr = &state.object_manager;
    let mut package_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for entry in obj_mgr.cache_by_address.iter() {
        let obj = entry.value();
        let pkg_name = extract_package_name(&obj.full_name);

        // Match legacy C++ logic: Include native Scripts, Engine core, and root Game folder
        if !pkg_name.is_empty() && (pkg_name.starts_with("/Script/") || pkg_name.starts_with("/Engine/") || pkg_name.starts_with("/Game/")) {
            *package_counts.entry(pkg_name).or_insert(0) += 1;
        }
    }

    let mut packages: Vec<PackageInfo> = package_counts.into_iter().map(|(name, count)| PackageInfo { name, object_count: count }).collect();

    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

#[derive(serde::Serialize)]
pub struct ObjectSummary {
    pub address: usize,
    pub name: String,
    pub full_name: String,
    pub type_name: String,
}

#[tauri::command]
pub fn get_objects(state: State<'_, AppState>, package_name: String, category: String) -> Result<Vec<ObjectSummary>, String> {
    let obj_mgr = &state.object_manager;
    let mut results = Vec::new();

    for entry in obj_mgr.cache_by_address.iter() {
        let obj = entry.value();
        let pkg_name = extract_package_name(&obj.full_name);

        if pkg_name == package_name {
            let is_match = match category.as_str() {
                "Class" => obj.type_name.contains("Class") && !obj.type_name.contains("Function"),
                "Struct" => obj.type_name.contains("Struct") && !obj.type_name.contains("Function"),
                "Enum" => obj.type_name.contains("Enum"),
                "Function" => obj.type_name.contains("Function"),
                _ => false, // fallback
            };
            if is_match {
                results.push(ObjectSummary { address: obj.address, name: obj.name.clone(), full_name: obj.full_name.clone(), type_name: obj.type_name.clone() });
            }
        }
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}
