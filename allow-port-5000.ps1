# Run this script as Administrator to allow your phone to reach the app on port 5000.
# Right-click PowerShell -> Run as administrator, then: .\allow-port-5000.ps1

$ruleName = "Flask AI Assistant"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Rule '$ruleName' already exists."
} else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
    Write-Host "Firewall rule added: inbound TCP port 5000 allowed."
}
Write-Host "Try opening from your phone: http://192.168.1.126:5000"
Write-Host "Make sure your phone is on the same Wi-Fi as this PC."
