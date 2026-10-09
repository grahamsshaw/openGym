@echo off
REM Nightly auto-pull: Flask imports -> bridge CSVs -> push to openGym.
REM Idempotent end to end: re-running pushes nothing twice. Logs to log\.
REM Schedule via Task Scheduler (see documentation/AUTO-PULL.md), or run by hand.
REM Needs OG_USER + OG_PASS in the environment (password login, not a passkey).
setlocal
set FITNESS=C:\Users\Graham\Desktop\Personal Fitness Tracker
set OG=C:\Users\Graham\Desktop\OpenGym-Personal
set OUT=%OG%\bridge\out
set LOG=%OG%\log\pull.log
if not exist "%OUT%" mkdir "%OUT%"

echo [%DATE% %TIME%] pull start >> "%LOG%"
py "%FITNESS%\scripts\import_data.py" --source all --days 30 >> "%LOG%" 2>&1
REM Phone files uploaded from the app land in the server inbox; stage the
REM newest of each recognised name over the manual export folder. (The
REM server timestamps repeat uploads, hence newest-match, not exact-name.)
for %%N in (Activity Sleep Vitals) do call :stage_one %%N
goto :after_stage
:stage_one
for /f "delims=" %%F in ('dir /b /o-d "%OG%\data\bridge\inbox\*%1.csv" 2^>nul') do (
  copy /Y "%OG%\data\bridge\inbox\%%F" "%FITNESS%\data\health_data_export\%1.csv" >> "%LOG%" 2>&1
  goto :staged_done
)
:staged_done
exit /b 0
:after_stage
py "%OG%\bridge\technogym_export_to_opengym.py" --input "%FITNESS%\data\technogym_export" --out "%OUT%" >> "%LOG%" 2>&1
py "%OG%\bridge\wii_to_opengym.py" --input "%FITNESS%\data\wii_fit" --out "%OUT%" >> "%LOG%" 2>&1
py "%OG%\bridge\health_connect_to_opengym.py" --input "%FITNESS%\data\health_data_export" --out "%OUT%" >> "%LOG%" 2>&1
py "%OG%\bridge\merge_workout_csvs.py" --inputs "%OUT%\opengym_workouts.csv" "%OUT%\opengym_phone_sessions.csv" --out "%OUT%\opengym_combined.csv" >> "%LOG%" 2>&1
"C:\Program Files\nodejs\node.exe" "%OG%\bridge\autopush.mjs" --url http://localhost:8080 --user "%OG_USER%" --pass "%OG_PASS%" --workouts "%OUT%\opengym_combined.csv" --weighins "%OUT%\opengym_weighins.csv" --live >> "%LOG%" 2>&1
echo [%DATE% %TIME%] pull exit %ERRORLEVEL% >> "%LOG%"
