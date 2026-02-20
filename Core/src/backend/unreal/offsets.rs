#[derive(Debug, Clone, Copy)]
pub struct UEOffset {
    pub id: usize,
    pub class: usize,
    pub fname_index: usize,
    pub outer: usize,

    pub super_struct: usize,
    pub member: usize,
    pub member_size: usize,
    pub member_type_offset: usize,
    pub member_type: usize,
    pub member_sub_type: usize,
    pub member_fname_index: usize,
    pub member_list: usize,
    pub member_list_size: usize,
    pub next_member: usize,
    pub next_member_same_class: usize,
    pub next_member_all_used: usize,
    pub offset: usize,
    pub prop_size: usize,
    pub property: usize,
    pub type_object: usize,
    pub bit_mask: usize,

    pub enum_name: usize,
    pub enum_list: usize,
    pub enum_size: usize,
    pub enum_prop_name: usize,
    pub enum_prop_index: usize,
    pub enum_prop_mul: usize,
    pub enum_type: usize,

    pub array: usize,
    pub map_key: usize,
    pub map_value: usize,
    pub struct_name: usize,

    pub funct: usize,
    pub funct_para: usize,
    pub funct_class: usize,
    pub next_para: usize,
    pub para_type: usize,
}

impl Default for UEOffset {
    fn default() -> Self {
        // Based on 64-bit target: ProcOffsetSub = 0, ProcOffsetAdd = 8
        let member = 0x50;
        let outer = 0x20;

        Self {
            id: 0xC,
            class: 0x10,
            fname_index: 0x18,
            outer,

            super_struct: 0x40,
            member,
            member_size: 0x58,
            member_type_offset: 0x8,
            member_type: 0x0,
            member_sub_type: 0x8,
            member_fname_index: 0x20, // UE5 default
            member_list: 0xA8,
            member_list_size: 0x0,
            next_member: 0x18, // UE5 default
            next_member_same_class: 0x50,
            next_member_all_used: 0x18,
            offset: 0x44,    // UE5 default
            prop_size: 0x34, // UE5 default
            property: 0x78,
            type_object: 0x70,
            bit_mask: 0x72, // UE5 default

            enum_name: 0x30,
            enum_list: 0x40,
            enum_size: 0x48,
            enum_prop_name: 0x0,
            enum_prop_index: 0x8,
            enum_prop_mul: 0x10,
            enum_type: 0x70,

            array: 0x70,
            map_key: 0x70,
            map_value: 0x70,
            struct_name: 0x70,

            funct: 0xD8,
            funct_para: member,
            funct_class: outer,
            next_para: 0x48,
            para_type: 0x70,
        }
    }
}
