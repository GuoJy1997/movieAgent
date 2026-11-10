@echo off
chcp 65001 >nul
start "MovieAgent 验收项目" "D:\movieAgent\libtv-studio\apps\desktop\release-spec002-task-recovery\win-unpacked\MovieAgent.exe" "--workspace-child" "--project-root=D:\movieAgent\projects\连续创作真实验收-20261031-601872" "--launcher-data=D:\movieAgent\spec\002-project-subprojects\verification\live-20261031\launcher" "--user-data-dir=D:\movieAgent\spec\002-project-subprojects\verification\live-20261031\user-data" "--model-config=D:/movieAgent/libtv-studio/config/models.json"
