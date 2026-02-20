#[derive(Debug, Clone, PartialEq)]
pub struct FName {
    pub index: u32,
    pub number: u32,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct UObject {
    pub address: usize,
    pub id: u32,
    pub fname_index: u32,
    pub outer_address: usize,
    pub class_address: usize,
}

impl UObject {
    pub fn new(address: usize, id: u32, fname_index: u32, outer_address: usize, class_address: usize) -> Self {
        Self { address, id, fname_index, outer_address, class_address }
    }
}
