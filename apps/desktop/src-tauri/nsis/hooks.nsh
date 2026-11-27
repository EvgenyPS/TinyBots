!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\resources\keyring.win32-x64-msvc.node"
    CopyFiles /SILENT "$INSTDIR\resources\keyring.win32-x64-msvc.node" "$INSTDIR\keyring.win32-x64-msvc.node"
  ${EndIf}
!macroend
