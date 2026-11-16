@echo off
setlocal
cd /d "%~dp0"
set "FOCUS_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "FOCUS_ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "FOCUS_ARCH=arm64"
for /f "delims=" %%F in ('dir /b /a-d /o-d "releases\windows-%FOCUS_ARCH%\Shiguang-*-portable.exe" 2^>nul') do (
  start "" "releases\windows-%FOCUS_ARCH%\%%F"
  exit /b 0
)
echo No desktop build found for %FOCUS_ARCH%.
echo Run pnpm build:%FOCUS_ARCH% and pnpm collect:%FOCUS_ARCH% first.
pause
exit /b 1
