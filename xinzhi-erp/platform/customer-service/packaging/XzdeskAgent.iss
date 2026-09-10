#define MyAppName "Xzdesk Agent"
#define MyAppVersion "3.0.6"
#define MyAppPublisher "Xzdesk"
#define MyAppExeName "XzdeskAgent.exe"

#ifndef SourceDir
#define SourceDir "..\build\bin"
#endif

#ifndef OutputDir
#define OutputDir "..\release"
#endif

[Setup]
AppId={{5A59D85A-4CFD-4AD9-BBAA-ED0717B0C26C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={code:GetDefaultDir}
DefaultGroupName={#MyAppName}
DisableDirPage=no
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=XzdeskAgentSetup_v3.0.6
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=..\build\windows\icon.ico

[Files]
Source: "{#SourceDir}\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\runtime\node\*"; DestDir: "{app}\runtime\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\sidecar\playwright-reader\*.mjs"; DestDir: "{app}\sidecar\playwright-reader"; Flags: ignoreversion; Excludes: "*.test.mjs"
Source: "..\sidecar\playwright-reader\package.json"; DestDir: "{app}\sidecar\playwright-reader"; Flags: ignoreversion
Source: "..\sidecar\playwright-reader\node_modules\*"; DestDir: "{app}\sidecar\playwright-reader\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{autodesktop}\Shopify AI Assistant.lnk"
Type: files; Name: "{autoprograms}\Shopify AI Assistant.lnk"
Type: files; Name: "{autodesktop}\Xzdesk.lnk"
Type: files; Name: "{autoprograms}\Xzdesk.lnk"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts"; Flags: checkedonce

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function GetDefaultDir(Param: String): String;
begin
  if DirExists('D:\') then
    Result := 'D:\XzdeskAgent'
  else
    Result := ExpandConstant('{localappdata}\XzdeskAgent');
end;
