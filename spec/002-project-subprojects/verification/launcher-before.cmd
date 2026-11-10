@echo off
chcp 65001 >nul
start "MovieAgent" "D:\movieAgent\libtv-studio\apps\desktop\release-flow-verified\win-unpacked\MovieAgent.exe" --project-launcher "--model-config=D:\movieAgent\libtv-studio\config\models.json"
