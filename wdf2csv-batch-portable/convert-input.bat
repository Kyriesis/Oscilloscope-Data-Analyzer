@echo off
chcp 65001 >nul
cls

echo ===========================================
echo   WDF Batch Converter
echo ===========================================
echo.
echo Paste the folder path containing .wdf files,
echo then press Enter:
echo.

set /p FOLDER="Folder path: "

set FOLDER=%FOLDER:"=%

if "%FOLDER%"=="" (
    echo.
    echo Error: no path entered.
    pause
    exit /b 1
)

if not exist "%FOLDER%\" (
    echo.
    echo Error: folder does not exist - %FOLDER%
    pause
    exit /b 1
)

dir /b "%FOLDER%\*.csv" >nul 2>&1
if %errorlevel% neq 0 goto start_convert

echo.
echo Warning: existing CSV files found in this folder.
echo Files with the same name as WDF files will be overwritten.
set /p CONFIRM="Continue? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

:start_convert
set "EXE=%~dp0wdf2csv-batch.exe"
set "DLL=%~dp0DLL"

echo.
echo Converting: %FOLDER%
echo.

"%EXE%" -i "%FOLDER%" -o "%FOLDER%" -d "%DLL%"

echo.
echo Done. Press any key to close...
pause >nul
