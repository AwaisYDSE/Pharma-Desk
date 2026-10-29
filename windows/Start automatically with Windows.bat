@echo off
cd /d "%~dp0"
set TARGET=%~dp0Start PharmaDesk Server.bat
set LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PharmaDesk Server.lnk
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');$s.TargetPath='%TARGET%';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo PharmaDesk server will now start automatically when this PC turns on.
pause
