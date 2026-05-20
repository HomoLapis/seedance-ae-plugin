@echo off
setlocal
pushd "%~dp0..\frontend-src"

if not exist node_modules (
    echo Installing dependencies...
    call npm install || goto :err
)

echo Building CEP bundle into ..\client\assets\ ...
set BUILD_TARGET=cep
call npm run build:cep || goto :err

popd
echo.
echo Done. Re-run install.bat to push to the AE extensions folder.
endlocal
exit /b 0

:err
popd
echo Build failed.
endlocal
exit /b 1
