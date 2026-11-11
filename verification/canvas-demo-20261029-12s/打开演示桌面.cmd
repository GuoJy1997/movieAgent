@echo off
chcp 65001 >nul
start "MovieAgent Canvas Demo" "D:\movieAgent\yangfan\apps\desktop\release-p5\win-unpacked\MovieAgent.exe" "--model-config=%~dp0models.json" --provider-evidence=fixture "--library-root=%~dp0library" "--user-data-dir=%~dp0profile" "--launcher-data=%~dp0launcher"
