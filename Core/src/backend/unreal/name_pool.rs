use crate::backend::os::process::Process;
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Emitter;

pub struct FNamePool {
    base_address: usize,
    string_offset: AtomicUsize,
}

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    current_chunk: usize,
    total_chunks: usize,
    current_names: usize,
    total_names: usize,
}

impl FNamePool {
    pub fn new(base_address: usize) -> Self {
        Self { base_address, string_offset: AtomicUsize::new(usize::MAX) }
    }

    pub fn get_name(&self, process: &Process, id: u32) -> Result<String, String> {
        let block = id >> 16;
        let offset = (id & 65535) as usize;

        // FNamePool_Entry is at base_address + 0x10
        let name_pool_entry = self.base_address + 0x10;
        let current_block_address = process.memory.read_pointer(name_pool_entry + (block as usize) * 8)?;

        // Offset shift is 2 (2 bytes per char pointer essentially)
        let name_entry_address = current_block_address + (offset * 2);

        let name_length = process.memory.read::<u16>(name_entry_address)? >> 6;

        if name_length < 1 || name_length > 200 {
            return Err(format!("Invalid name length: {}", name_length));
        }

        let mut offset_val = self.string_offset.load(Ordering::Acquire);

        // Lazy offset discovery
        if offset_val == usize::MAX {
            if id > 0 && id < 7 && name_length > 10 && name_length < 15 {
                for i in 2..0x20 {
                    if let Ok(buf) = process.memory.read_bytes(name_entry_address + i, name_length as usize) {
                        if let Ok(s) = std::str::from_utf8(&buf) {
                            if s == "ByteProperty" || s.contains("ByteProperty") {
                                self.string_offset.compare_exchange(usize::MAX, i, Ordering::Release, Ordering::Relaxed).ok();
                                offset_val = i;
                                break;
                            }
                        }
                    }
                }
            }
            // If still uninitialized, we can't read it yet, or we fall back
            if offset_val == usize::MAX {
                return Err("Name pool string offset not initialized yet".to_string());
            }
        }

        let name_str_address = name_entry_address + offset_val;
        process.memory.read_string(name_str_address, name_length as usize)
    }

    /// Multithreaded parser that counts chunks, emits progress
    pub fn parse_pool(&self, process: &Process, app_handle: &tauri::AppHandle) -> Result<(u32, u32), String> {
        // 讀取 NamePool 的 Chunk 數量
        let name_pool_entry = self.base_address + 0x10;
        let mut valid_blocks = 0;
        let mut null_cnt = 0;

        for i in 0..500 {
            if let Ok(block_address) = process.memory.read_pointer(name_pool_entry + i * 8) {
                // Confirm it's a valid pointer by trying to read from it
                if block_address > 0x10000 && process.memory.read_pointer(block_address).is_ok() {
                    valid_blocks += 1;
                    null_cnt = 0; // Reset null count if we found a valid block, matching original C++ logic
                } else {
                    null_cnt += 1;
                }
            } else {
                null_cnt += 1;
            }

            if null_cnt >= 3 {
                break;
            }
        }

        // 開始分析字串，停止條件為找到 /Script/CoreUObject 或讀取完所有字串 (總之先做多第一輪大規模的分析)
        let total_names_capacity = valid_blocks << 0x10; // 2^16 (4bytes) = 65536
        let batch_size = 0x200;
        let num_batches = (total_names_capacity + batch_size - 1) / batch_size;

        let progress = AtomicUsize::new(0);
        let valid_names_count = AtomicUsize::new(0);
        let dynamic_total_names = AtomicUsize::new(10_000); // 初始目標值

        // Required to satisfy Send trait over rayon boundaries if Process contains raw HANDLE
        // We know HANDLE is sync/send safe in our context.
        let process_ref = process;

        (0..num_batches).into_par_iter().for_each(|batch_idx| {
            let start = batch_idx * batch_size;
            let end = start + batch_size;
            let mut local_valid_names = 0;

            for id in start..end {
                if self.get_name(process_ref, id as u32).is_ok() {
                    local_valid_names += 1;
                }
            }

            let current_total_names = valid_names_count.fetch_add(local_valid_names, Ordering::Relaxed) + local_valid_names;

            // 動態擴張 total_names 讓進度條有一種不斷推進的感覺
            let mut current_target = dynamic_total_names.load(Ordering::Relaxed);
            while current_total_names >= current_target {
                let next_target = current_target * 2;
                let _ = dynamic_total_names.compare_exchange(current_target, next_target, Ordering::Relaxed, Ordering::Relaxed);
                current_target = dynamic_total_names.load(Ordering::Relaxed); // 重新取得最新目標
            }

            let current = progress.fetch_add(1, Ordering::Relaxed) + 1;

            if current % 10 == 0 || current == num_batches {
                app_handle.emit("fname-pool-progress", ProgressPayload { current_chunk: current, total_chunks: num_batches, current_names: current_total_names, total_names: current_target }).ok();
            }
        });

        let final_count = valid_names_count.load(Ordering::Relaxed);
        let final_target = final_count; // 最後一刻把 total 設成實際的 total，讓進度條 100% 滿格

        app_handle.emit("fname-pool-progress", ProgressPayload { current_chunk: num_batches, total_chunks: num_batches, current_names: final_count, total_names: final_target }).ok();

        Ok((valid_blocks as u32, final_count as u32))
    }
}
