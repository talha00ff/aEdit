@echo off
title aEdit by talha0ff - Install
echo.
echo  aEdit by talha0ff - installer
echo  ------------------------------
echo  Close Premiere Pro before continuing.
echo.
pause

REM allow unsigned CEP panels (Premiere 2020 - 2026)
for %%v in (9 10 11 12 13 14) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

set "DEST=%APPDATA%\Adobe\CEP\extensions\aEdit"
set "KEEP=%TEMP%\aedit_ffmpeg_keep.exe"
if exist "%KEEP%" del /q "%KEEP%"
if exist "%DEST%" (
  echo  Updating existing aEdit...
  if exist "%DEST%\bin\ffmpeg.exe" copy /y "%DEST%\bin\ffmpeg.exe" "%KEEP%" >nul
  rmdir /s /q "%DEST%"
)
echo  Copying files...
xcopy "%~dp0aEdit" "%DEST%\" /e /i /y /q >nul
if errorlevel 1 (
  echo  ERROR: copy failed. Make sure you extracted the zip first.
  pause
  exit /b 1
)

if not exist "%DEST%\bin\ffmpeg.exe" if exist "%KEEP%" move /y "%KEEP%" "%DEST%\bin\ffmpeg.exe" >nul
if not exist "%DEST%\bin\ffmpeg.exe" (
  echo  ffmpeg not in package - downloading it ^(needed for Pose Cut, Beat Marker, Beat Edit^)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\bin\get-ffmpeg.ps1" -Dest "%DEST%"
  if errorlevel 1 (
    echo.
    echo  WARNING: ffmpeg could not be downloaded. Check the internet connection and run INSTALL.bat again,
    echo  or copy ffmpeg.exe into: %DEST%\bin
  )
)

REM remove the "downloaded from internet" flag so ffmpeg can run
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%DEST%' -Recurse | Unblock-File" >nul 2>&1

echo.
echo  Done! Open Premiere Pro, then: Window ^> Extensions ^> aEdit
echo.
pause
