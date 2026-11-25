@echo off
setlocal
cd /d "%~dp0"
title Un Instant Chez Moi - Atelier local
echo Atelier Stock Symphony
echo Gardez cette fenetre ouverte pendant votre travail. Fermez-la pour arreter.
"%~dp0runtime\windows\python.exe" "%~dp0local\server.py"
if errorlevel 1 pause
