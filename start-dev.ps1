# start-dev.ps1
$root = $PSScriptRoot

Write-Host "Starting backend (FastAPI, port 8001)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", `
    "cd '$root\backend'; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload --port 8001"

Write-Host "Starting frontend (Vite, port 5173)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", `
    "cd '$root\frontend'; `$env:PATH += ';C:\Program Files\nodejs'; npm run dev"

Write-Host "Both servers launching in separate windows. Give them a few seconds, then open http://localhost:5173/" -ForegroundColor Green