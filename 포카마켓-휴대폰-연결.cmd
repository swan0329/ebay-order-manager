@echo off
chcp 65001 >nul
title 포카마켓 휴대폰 연결
cd /d "%~dp0"
node "%~dp0scripts\pocamarket-phone-connect.mjs"
echo.
if errorlevel 1 echo 연결 도우미를 시작하지 못했습니다. 위 안내를 확인해 주세요.
echo 이 창을 닫으려면 아무 키나 누르세요.
pause >nul
