# Sample: create a PENDING ticket on the local MCP server (requires mcp-server on :3000).
# Usage:  .\scripts\sample-ticket-test.ps1
# Before:  cd mcp-server; npx tsx src/db/demo_seed.ts   # optional
#          cd mcp-server; npx tsx src/index.ts          # in another terminal

$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"

Write-Host "Logging in as voice agent..."
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST -ContentType "application/json" `
    -Body '{"username":"voice","password":"voicepass"}'
if (-not $login.success) { throw "Login failed: $($login | ConvertTo-Json)" }

$token = $login.data.token
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$body = @{
    title = "Sample test ticket $(Get-Date -Format o)"
    description = "Automated sample ticket for VOID fix-agent / orchestrator testing."
    component = "Focus-Flow-"
    priority = "MEDIUM"
} | ConvertTo-Json

Write-Host "Creating ticket..."
$res = Invoke-RestMethod -Uri "$base/api/tickets" -Method POST -Headers $headers -Body $body
if (-not $res.success) { throw "Create failed: $($res | ConvertTo-Json)" }

$id = $res.data.ticket_id
Write-Host "OK: created $id (PENDING). Start fix-agent in another terminal to process it."
