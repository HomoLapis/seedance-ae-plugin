@echo off
setlocal
title Seedance Studio - AE Plugin Installer (Windows)
echo ============================================
echo   Seedance Studio - AE Plugin Installer
echo   Windows
echo ============================================
echo.

:: [1/3] Enable CEP debug mode (unsigned extensions need this)
echo [1/3] Enabling CEP debug mode...
for %%v in (8 9 10 11 12) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo       Debug mode enabled for CSXS 8-12.

:: [2/3] Install by copying to user CEP extensions folder
echo.
echo [2/3] Installing extension...
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.seedance.studio"

if exist "%DEST%" (
    echo       Removing previous installation...
    rmdir /S /Q "%DEST%"
)

xcopy "%~dp0CSXS"                 "%DEST%\CSXS\"                 /E /I /Q /Y >nul
xcopy "%~dp0client"               "%DEST%\client\"               /E /I /Q /Y >nul
xcopy "%~dp0client-storyboarder"  "%DEST%\client-storyboarder\"  /E /I /Q /Y >nul
xcopy "%~dp0host"                 "%DEST%\host\"                 /E /I /Q /Y >nul
echo       Extension installed to: %DEST%

:: [3/3] Sanity-check
echo.
echo [3/3] Verifying installation...
set OK=1
if not exist "%DEST%\CSXS\manifest.xml"       ( echo       MISSING: CSXS\manifest.xml & set OK=0 )
if not exist "%DEST%\client\index.html"       ( echo       MISSING: client\index.html & set OK=0 )
if not exist "%DEST%\client\assets\index.js"  ( echo       MISSING: client\assets\index.js & set OK=0 )
if not exist "%DEST%\host\index.jsx"          ( echo       MISSING: host\index.jsx & set OK=0 )

if "%OK%"=="0" (
    echo.
    echo   Installation INCOMPLETE - see missing files above.
    pause
    exit /b 1
)
echo       All required files present.

echo.
echo ============================================
echo   Done.
echo.
echo   1. Open or restart After Effects
echo   2. Window ^> Extensions ^> Seedance Studio
echo                          ^> Storyboarder
echo   3. Click Settings, paste your API keys
echo      (BytePlus ARK + optional Z.AI/FAL/Alibaba)
echo.
echo   No backend, no Python. Just keys.
echo ============================================
echo.
pause
endlocal
