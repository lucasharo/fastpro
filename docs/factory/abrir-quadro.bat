@echo off
rem Liga o servidor do quadro da fabrica e abre a pagina no navegador.
rem Se o servidor ja estiver ligado, a janela mostra erro de porta em uso: e' normal, o quadro ja esta no ar.
cd /d "%~dp0\..\.."
start "" http://127.0.0.1:8765/quadro.html
node docs/factory/servidor-quadro.mjs
pause
