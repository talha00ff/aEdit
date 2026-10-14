@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title aEdit - build signed ZXP
echo.
echo  aEdit - signed ZXP builder
echo  --------------------------

REM 1) Adobe's signing tool
set "TOOL=%~dp0tools\ZXPSignCmd.exe"
if not exist "%TOOL%" (
  echo  Downloading Adobe ZXPSignCmd...
  if not exist tools mkdir tools
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe' -OutFile 'tools\ZXPSignCmd.exe'"
)
if not exist "%TOOL%" (
  echo  ERROR: could not download ZXPSignCmd. Download it by hand from
  echo  github.com/Adobe-CEP/CEP-Resources  ^(ZXPSignCMD/4.1.3/x64^) into the tools folder.
  pause & exit /b 1
)

REM 2) never ship ffmpeg inside the ZXP (size + GPL); the panel downloads it itself
if exist "aEdit\bin\ffmpeg.exe" (
  echo  ERROR: aEdit\bin\ffmpeg.exe is in the package folder. Remove it first.
  pause & exit /b 1
)
for /r "aEdit" %%f in (.debug *.before-*) do if exist "%%f" del /q "%%f"

REM 3) version from the manifest
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "([xml](Get-Content 'aEdit\CSXS\manifest.xml')).ExtensionManifest.ExtensionBundleVersion"`) do set "VER=%%v"
echo  Version: %VER%

REM 4) certificate (made once, reuse it for every update)
echo.
echo  Certificate password (letters and numbers only; keep it, you need it for every update):
set /p "PASS=  Password: "
if "%PASS%"=="" ( echo  No password given. & pause & exit /b 1 )
if not exist cert mkdir cert
if not exist "cert\aEdit_cert.p12" (
  echo  Creating your self-signed certificate...
  "%TOOL%" -selfSignedCert TR Istanbul talha0ff talha0ff %PASS% "cert\aEdit_cert.p12" -validityDays 3650
  if errorlevel 1 ( echo  ERROR: certificate could not be created. & pause & exit /b 1 )
)

REM 5) sign (with timestamp so it stays valid after the cert expires)
if not exist dist mkdir dist
set "OUT=dist\aEdit_v%VER%.zxp"
if exist "%OUT%" del /q "%OUT%"
echo  Signing...
"%TOOL%" -sign aEdit "%OUT%" "cert\aEdit_cert.p12" %PASS% -tsa http://timestamp.digicert.com
if errorlevel 1 (
  echo  Timestamp server failed, signing without timestamp...
  "%TOOL%" -sign aEdit "%OUT%" "cert\aEdit_cert.p12" %PASS%
)
if not exist "%OUT%" ( echo  ERROR: signing failed ^(wrong password?^) & pause & exit /b 1 )

REM 6) check
"%TOOL%" -verify "%OUT%"
echo.
echo  Done: %OUT%
echo  Keep the cert folder and your password private. Do NOT upload them to GitHub.
echo.
pause
