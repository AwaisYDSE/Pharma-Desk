; PharmaDesk Windows installer — Developed by Awais Amin.
; One click: installs into Program Files (protected: only an administrator can change or remove it),
; keeps the shop's data in a hidden folder, starts the server with Windows, opens the owner setup,
; and removes the downloaded installer file afterwards.
#ifndef AppDir
  #define AppDir "..\pkg\app"
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6E2B1C55-3A7D-4C1F-9B7E-5D2A1F0C8E41}
AppName=PharmaDesk
AppVersion={#AppVersion}
AppPublisher=Awais Amin
AppPublisherURL=https://awaisydse.github.io/Pharma-Desk/
DefaultDirName={autopf}\PharmaDesk
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableWelcomePage=yes
DisableFinishedPage=yes
PrivilegesRequired=admin
OutputDir=..\out
OutputBaseFilename=PharmaDesk-Setup
SetupIconFile=pharmadesk.ico
UninstallDisplayIcon={app}\pharmadesk.ico
UninstallDisplayName=PharmaDesk
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "pharmadesk.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "PharmaDesk.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; The shop's data: hidden, and every Windows user on this PC may write to it (the server runs as the user).
Name: "{commonappdata}\PharmaDesk"; Permissions: users-modify; Attribs: hidden

[Icons]
Name: "{autoprograms}\PharmaDesk"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\PharmaDesk.vbs"""; IconFilename: "{app}\pharmadesk.ico"
Name: "{autodesktop}\PharmaDesk"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\PharmaDesk.vbs"""; IconFilename: "{app}\pharmadesk.ico"
; Starts quietly every time Windows starts, so phones can always connect.
Name: "{commonstartup}\PharmaDesk Server"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\PharmaDesk.vbs"" /background"; IconFilename: "{app}\pharmadesk.ico"

[Run]
; Let phones on the shop Wi-Fi reach the server without a Windows Firewall pop-up.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""PharmaDesk"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""PharmaDesk"" dir=in action=allow program=""{app}\pharmadesk-node.exe"" enable=yes profile=any"; Flags: runhidden
; Start PharmaDesk and open the owner setup in the browser (only in a normal, visible install).
Filename: "{sys}\wscript.exe"; Parameters: """{app}\PharmaDesk.vbs"""; Flags: nowait runasoriginaluser; Check: not WizardSilent
; Remove the downloaded installer from Downloads once it has done its job.
Filename: "{cmd}"; Parameters: "/c ping 127.0.0.1 -n 6 >nul & del /f /q ""{srcexe}"""; Flags: runhidden nowait; Check: InDownloads and (not WizardSilent)

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im pharmadesk-node.exe"; Flags: runhidden; RunOnceId: "StopServer"
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im cloudflared.exe"; Flags: runhidden; RunOnceId: "StopTunnel"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""PharmaDesk"""; Flags: runhidden; RunOnceId: "Firewall"

[Code]
// Stop a running copy before upgrading, so files can be replaced.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im pharmadesk-node.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im cloudflared.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;

function InDownloads: Boolean;
begin
  Result := Pos('\DOWNLOADS\', Uppercase(ExpandConstant('{srcexe}'))) > 0;
end;
