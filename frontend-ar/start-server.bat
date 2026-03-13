@echo off
echo ===================================================
echo Iniciando Servidor WebAR
echo ===================================================
echo.
echo Abriendo navegador en http://localhost:8000/index.html (Version BARCODES)
start http://localhost:8000/index.html
echo.
echo Presiona Ctrl+C para detener el servidor.
echo.
python -m http.server 8000
pause