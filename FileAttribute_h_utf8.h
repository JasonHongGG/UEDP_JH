#pragma once
#include <Windows.h>
#include <string>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <winver.h>
#include "Process.h"


class FileAttributeManager
{
public:
    bool QueryValue(const std::string& ValueName, std::string& RetStr, bool RetNum = false);

    bool	GetFileDescription(std::string& RetStr);   //獲取文件說明
    bool	GetFileVersion(std::string& RetStr);	   //獲取文件版本	// RetNum = std::stoi(RetStr);
    bool	GetInternalName(std::string& RetStr);	   //獲取內部名稱
    bool	GetCompanyName(std::string& RetStr);	   //獲取公司名稱
    bool	GetLegalCopyright(std::string& RetStr);    //獲取版權
    bool	GetOriginalFilename(std::string& RetStr);  //獲取原始文件名
    bool	GetProductName(std::string& RetStr);	   //獲取產品名稱
    bool	GetProductVersion(std::string& RetStr);    //獲取產品版本
private:
};

inline FileAttributeManager FileAttrMgr = FileAttributeManager();



//使用方式
/*
int RetNum123;
std::string RetStr123;

FileAttrMgr.GetFileDescription(RetStr123);
std::cout << "[FileDescription]    " << RetStr123 << std::endl;

FileAttrMgr.GetFileVersion(RetStr123);
printf("[FileVersion] %s\n", RetStr123.c_str());
std::cout << "[FileVersion]    " << RetStr123 << std::endl;

FileAttrMgr.GetFileVersionNumber(RetNum123);
printf("[FileVersion Number] %d\n", RetNum123);

FileAttrMgr.GetInternalName(RetStr123);
std::cout << "[InternalName]    " << RetStr123 << std::endl;

FileAttrMgr.GetCompanyName(RetStr123);
std::cout << "[CompanyName]    " << RetStr123 << std::endl;

FileAttrMgr.GetLegalCopyright(RetStr123);
std::cout << "[LegalCopyright]    " << RetStr123 << std::endl;

FileAttrMgr.GetOriginalFilename(RetStr123);
std::cout << "[OriginalFilename]    " << RetStr123 << std::endl;

FileAttrMgr.GetProductName(RetStr123);
std::cout << "[ProductName]    " << RetStr123 << std::endl;

FileAttrMgr.GetProductVersion(RetStr123);
std::cout << "[ProductVersion]    " << RetStr123 << std::endl;

*/
