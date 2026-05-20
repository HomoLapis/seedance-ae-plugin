@echo off
setlocal
title Seedance Studio - Uninstall
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.seedance.studio"

echo Removing %DEST% ...
if exist "%DEST%" (
    rmdir /S /Q "%DEST%"
    echo Done.
) else (
    echo Nothing to remove - extension is not installed.
)
echo.
pause
endlocal
