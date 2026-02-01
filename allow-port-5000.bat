@echo off
:: Right-click this file -> Run as administrator
netsh advfirewall firewall add rule name="Flask AI Assistant" dir=in action=allow protocol=TCP localport=5000
if %errorlevel% equ 0 (
    echo Firewall rule added. Try from your phone: http://192.168.1.126:5000
) else (
    echo Run this file as Administrator: right-click -> Run as administrator
)
pause
