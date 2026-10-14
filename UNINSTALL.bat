@echo off
title aEdit by talha0ff - Uninstall
set "DEST=%APPDATA%\Adobe\CEP\extensions\aEdit"
if exist "%DEST%" (rmdir /s /q "%DEST%" & echo  aEdit removed.) else (echo  aEdit is not installed.)
pause
