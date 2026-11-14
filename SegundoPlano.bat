@echo off
title Contador - Captura de Tecla em 2o Plano
echo Captura de teclas em segundo plano ativa na porta 31337.
echo Voce ja pode jogar normalmente com o navegador ou janela flutuante em segundo plano!
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bg-bridge.ps1"
