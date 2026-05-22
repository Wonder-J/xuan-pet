@echo off
chcp 65001 >nul
title 玄神 - 桌面宠物

set ROOT_DIR=%~dp0
set PYTHON_DIR=%ROOT_DIR%apps\desktop\python
set VENV_DIR=%PYTHON_DIR%\.venv

echo [*] 玄神桌面宠物 - Windows 启动脚本
echo.

:: ============ 检查 Python ============
set PYTHON_CMD=
where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
    set PYTHON_CMD=python
)
if not defined PYTHON_CMD (
    where python3 >nul 2>&1
    if %errorlevel%==0 (
        set PYTHON_CMD=python3
    )
)
if not defined PYTHON_CMD (
    echo [X] 未找到 Python，请先安装 Python 3.9+
    echo     下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo [√] 使用 Python: %PYTHON_CMD%

:: ============ 创建/检查虚拟环境 ============
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [!] 创建虚拟环境: %VENV_DIR%
    %PYTHON_CMD% -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo [X] 创建虚拟环境失败
        pause
        exit /b 1
    )
    echo [√] 虚拟环境已创建
) else (
    echo [√] 虚拟环境已存在
)

:: 激活虚拟环境
call "%VENV_DIR%\Scripts\activate.bat"
echo [√] 虚拟环境已激活

:: ============ 安装 Python 依赖 ============
if not exist "%VENV_DIR%\requirements.installed" (
    echo [!] 安装 Python 依赖...
    echo     依赖文件: %PYTHON_DIR%\requirements.txt
    if not exist "%PYTHON_DIR%\requirements.txt" (
        echo [X] 找不到 requirements.txt 文件: %PYTHON_DIR%\requirements.txt
        pause
        exit /b 1
    )
    "%VENV_DIR%\Scripts\pip.exe" install -r "%PYTHON_DIR%\requirements.txt"
    if %errorlevel% neq 0 (
        echo [X] Python 依赖安装失败
        pause
        exit /b 1
    )
    echo. > "%VENV_DIR%\requirements.installed"
    echo [√] Python 依赖安装完成
) else (
    echo [√] Python 依赖已是最新
)

:: ============ 检查 pnpm ============
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] 未找到 pnpm，请先安装: npm install -g pnpm
    pause
    exit /b 1
)

:: ============ 安装 Node 依赖 ============
if not exist "%ROOT_DIR%node_modules" (
    echo [!] 安装 Node 依赖...
    cd /d "%ROOT_DIR%"
    pnpm install
    if %errorlevel% neq 0 (
        echo [X] Node 依赖安装失败
        pause
        exit /b 1
    )
    echo [√] Node 依赖安装完成
)

:: ============ 启动语音服务 ============
echo [*] 启动语音服务...
start "" /b "%VENV_DIR%\Scripts\python.exe" "%PYTHON_DIR%\voice_service.py" --port 17599
:: 给语音服务一点启动时间
timeout /t 2 /nobreak >nul
echo [√] 语音服务已启动 (端口 17599)

:: ============ 启动 Electron ============
echo [*] 启动桌面宠物...
cd /d "%ROOT_DIR%"
pnpm dev

:: 结束时清理
echo [*] 正在关闭...
taskkill /f /im python.exe /fi "WINDOWTITLE eq voice_service*" >nul 2>&1
echo [√] 已退出
pause