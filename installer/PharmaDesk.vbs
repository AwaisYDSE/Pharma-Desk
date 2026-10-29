' Starts the PharmaDesk server with no black window.
' "PharmaDesk.vbs"              -> start (if needed) and open PharmaDesk in the browser
' "PharmaDesk.vbs" /background  -> start quietly (used when Windows starts)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set env = sh.Environment("PROCESS")
env("PHARMADESK_DATA") = sh.ExpandEnvironmentStrings("%ProgramData%") & "\PharmaDesk"
env("CLOUDFLARED") = dir & "\cloudflared.exe"
If WScript.Arguments.Count > 0 Then env("PHARMADESK_OPEN") = "0" Else env("PHARMADESK_OPEN") = "1"
sh.Run """" & dir & "\pharmadesk-node.exe"" --no-warnings """ & dir & "\server\server.mjs""", 0, False
