#include "DumperUtils.h"

template <class U>
DWORD_PTR DumperUtilsSet::CheckValue(DWORD_PTR Address, size_t Size, U Value, size_t Type, bool StrFullCompare)
{
    // 用途 : 在指定 Address 附近的 Size 範圍內，找尋 InputValue
    // 如果有找到則回傳找到的 Offest，反則為 NULL

    //檢查 Address 是否有效
    if (!MemMgr.MemReader.IsPointer(Address)) return NULL;

    // Read Bytes Form Address
    BYTE* BytesBuffer = new BYTE[Size + 0x10];
    MemMgr.MemReader.ReadBytes(Address, BytesBuffer, Size);

    // 變數
    std::vector<unsigned char> Data;
    int TempValue, InputValue_1 = 0, InputValue_2 = 0;
    std::string InputString;

    if (std::is_same<U, std::string>::value) {      //暫時未實作可能有 "~" 的字處需處理
        InputString = Value;
        //InputValue_1 = std::stoi(InputString.substr(InputString.find("~")+1));
        //InputValue_2 = std::stoi(InputString.substr(0, InputString.find("~")));;
    }
    else if (std::is_same<U, int>::value) {
        if constexpr (std::is_convertible_v<U, int>) {
            InputValue_1 = static_cast<int>(Value);
        }
    }

    // =================
    if (Type == 1) {  // 字串
        std::string FName;

        for (size_t i = 0; i < Size; i += 4) {
            Data.clear();

            // 4 bytes 轉數字
            for (size_t m = 0; m < 4; ++m)
                Data.push_back(*(BytesBuffer + i + m));
            TempValue = Utils.BytesToNum(Data);

            // 嘗試取字串
            if (FNameParser.GetFNameStringByID(TempValue, FName, true)) {
                // FName 有字串，且 FName 和 InputString 部分匹配(StrFullCompare == false)、完整匹配(StrFullCompare == true)
                if (!FName.empty()) {
                    if ((!StrFullCompare and FName.find(InputString) != std::string::npos) or (FName == InputString)) {    //完全匹配或部分匹配
                        delete[] BytesBuffer;
                        return Address + i;
                    }
                }
            }
        }
    }
    else if (Type == 2 || Type == 4 || Type == 8) {      //數字 // 兩個、四個、八個 bytes 一組
        for (size_t i = 0; i < Size; i += Type) {
            Data.clear();
            for (size_t m = 0; m < Type; ++m) {
                Data.push_back(*(BytesBuffer + i + m));
            }
            TempValue = Utils.BytesToNum(Data);
            // 如果 TempValue 和 InputValue_1 相等
            // 或是 InputValue_2 存在，且InputValue_2 >= TempValue >= InputValue_1
            if (TempValue == InputValue_1 || (InputValue_2 && TempValue >= InputValue_1 && InputValue_2 >= InputValue_1)) {
                delete[] BytesBuffer;
                return Address + i;
            }
        }
    }
    delete[] BytesBuffer;
    return NULL;
}

bool DumperUtilsSet::GetUEVersion() {
    if (StorageMgr.UEVersion.IsInitialized()) {
        printf("[ UE Version Exist ] %d\n\n", (int)StorageMgr.UEVersion.Get());
        return true;
    }

    std::string UEVersionStr = "";
    FileAttrMgr.GetFileVersion(UEVersionStr);
    StorageMgr.UEVersion.Set(std::stoi(UEVersionStr));
    printf("[ UE Version ] %s\n\n", UEVersionStr.c_str());
    return true;
}



// 顯式實例化 (讓 template 可以定義在 cpp)
template DWORD_PTR DumperUtilsSet::CheckValue<int>(DWORD_PTR, size_t, int, size_t, bool);
template DWORD_PTR DumperUtilsSet::CheckValue<std::string>(DWORD_PTR, size_t, std::string, size_t, bool);
