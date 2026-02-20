

#include "FileAttribute.h"  

bool FileAttributeManager::QueryValue(const std::string& ValueName, std::string& RetStr, bool RetNum)
{
    BYTE* lpVersionData = NULL;
    DWORD dwLangCharset = 0;
    CHAR* tmpstr = NULL;

    // 取得檔案路徑
    char szProcessPath[MAX_PATH];
    if (GetModuleFileNameExA(ProcessInfo::hProcess, NULL, szProcessPath, MAX_PATH) == 0) {
        std::cerr << "Failed to get process file path. Error code: " << GetLastError() << std::endl;
        return false;
    }

    // 取得 Info Size
    DWORD dwHandle;
    DWORD dwDataSize = GetFileVersionInfoSizeA(szProcessPath, &dwHandle);
    if (dwDataSize == 0) {
        std::cerr << "Failed to get version info size. Error code: " << GetLastError() << std::endl;
        return false;
    }

    // 創建緩衝區 => File Info、取得 File Info
    lpVersionData = new (std::nothrow) BYTE[dwDataSize];
    if (NULL == lpVersionData) return false;
    if (!GetFileVersionInfoA(szProcessPath, 0, dwDataSize, (void*)lpVersionData)) return false;


    // 設置語言 => 16進位 8位數字
    UINT nQuerySize;
    DWORD* pTransTable;
    if (!::VerQueryValueA(lpVersionData, "\\VarFileInfo\\Translation", (void**)&pTransTable, &nQuerySize)) return false;

    dwLangCharset = MAKELONG(HIWORD(pTransTable[0]), LOWORD(pTransTable[0]));
    if (lpVersionData == NULL) return false;
        

    // 創建緩衝區 => 取得結果字串
    tmpstr = new (std::nothrow) CHAR[128];
    if (NULL == tmpstr) return false;
    sprintf_s(tmpstr, 128, "\\StringFileInfo\\%08lx\\%s", dwLangCharset, ValueName.c_str());


    // 調用此函數查詢前需要先依次調用函數GetFileVersionInfoSize和GetFileVersionInfo
    LPVOID lpData;
    if (::VerQueryValueA((void*)lpVersionData, tmpstr, &lpData, &nQuerySize))
        RetStr = (char*)lpData;


    // 查詢檔案版本資訊
    if (ValueName == "FileVersion") {
        VS_FIXEDFILEINFO* pFileInfo = nullptr;
        UINT uLen = 0;
        if (!VerQueryValueA(lpVersionData, "\\", reinterpret_cast<void**>(&pFileInfo), &uLen)) return false;

        // 解析檔案版本
        DWORD dwFileVersionMS = pFileInfo->dwFileVersionMS;
        DWORD dwFileVersionLS = pFileInfo->dwFileVersionLS;
        DWORD dwVersionMajor = HIWORD(dwFileVersionMS);
        DWORD dwVersionMinor = LOWORD(dwFileVersionMS);
        DWORD dwVersionBuild = HIWORD(dwFileVersionLS);
        DWORD dwVersionRevision = LOWORD(dwFileVersionLS);

        std::ostringstream oss;
        if(RetNum)  oss << dwVersionMajor << "" << dwVersionMinor;
        else        oss << dwVersionMajor << "." << dwVersionMinor << "." << dwVersionBuild << "." << dwVersionRevision;
        RetStr = oss.str();
    }



    // 清除緩衝區
    if (lpVersionData)
    {
        delete[] lpVersionData;
        lpVersionData = NULL;
    }
    if (tmpstr)
    {
        delete[] tmpstr;
        tmpstr = NULL;
    }

    return true;
}




// ================== Methon ==================

bool FileAttributeManager::GetFileDescription(std::string& RetStr)
{
    return QueryValue("FileDescription", RetStr);
};

bool FileAttributeManager::GetFileVersion(std::string& RetStr)
{
    return QueryValue("FileVersion", RetStr);
};

bool FileAttributeManager::GetInternalName(std::string& RetStr)
{
    return QueryValue("InternalName", RetStr);
};
bool FileAttributeManager::GetCompanyName(std::string& RetStr)
{
    return QueryValue("CompanyName", RetStr);
};
bool FileAttributeManager::GetLegalCopyright(std::string& RetStr)
{
    return QueryValue("LegalCopyright", RetStr);
};
bool FileAttributeManager::GetOriginalFilename(std::string& RetStr)
{
    return QueryValue("OriginalFilename", RetStr);
};
bool FileAttributeManager::GetProductName(std::string& RetStr)
{
    return QueryValue("ProductName", RetStr);
};
bool FileAttributeManager::GetProductVersion(std::string& RetStr)
{
    return QueryValue("ProductVersion", RetStr);
};
