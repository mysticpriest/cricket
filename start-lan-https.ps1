# Cricket LAN HTTPS developer launcher (Windows PowerShell 5.1+).
# Unique self-signed certificate made with Windows PKI; no extra packages.
param([string]$LanIP = "",[ValidateRange(1,65535)][int]$Port = 3001)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
    throw "Windows certificate tools are unavailable; use Windows PowerShell with the PKI module."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm must be available in PATH."
}
if ([string]::IsNullOrWhiteSpace($LanIP)) {
    $choices = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
        $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and
        $_.AddressState -eq 'Preferred'
    } | Select-Object -ExpandProperty IPAddress -Unique)
    if ($choices.Count -eq 1) {
        $LanIP = [string]$choices[0]
        Write-Host "Detected LAN address: $LanIP" -ForegroundColor Cyan
    } else {
        Write-Host "Available private IPv4 addresses: $($choices -join ', ')"
        $LanIP = Read-Host 'Enter the IPv4 address of the computer hosting Cricket'
    }
}
$parsedIP = $null
if (-not [System.Net.IPAddress]::TryParse($LanIP,[ref]$parsedIP) -or
    $parsedIP.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw "LanIP must be the hosting PC's IPv4 address (example: 192.168.1.100)."
}
if ($LanIP -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
    throw "Only private LAN IPv4 addresses are supported. Never expose Cricket's dev server publicly."
}
$certDir = Join-Path $PSScriptRoot 'data\certs'
New-Item -ItemType Directory -Path $certDir -Force | Out-Null
$pfxPath = Join-Path $certDir 'cricket-lan.pfx'
$cerPath = Join-Path $certDir 'cricket-lan.cer'
$secretPath = Join-Path $certDir 'cricket-lan-password.dpapi'
$ipPath = Join-Path $certDir 'cricket-lan-ip.txt'
$existingIP = ''
if (Test-Path -LiteralPath $ipPath) {
    $existingIP = (Get-Content -LiteralPath $ipPath -Raw).Trim()
}
$needsCertificate = -not (Test-Path $pfxPath) -or -not (Test-Path $cerPath) -or
    -not (Test-Path $secretPath) -or $existingIP -ne $LanIP
if ($needsCertificate) {
    Write-Host "Creating a private LAN HTTPS certificate for $LanIP..." -ForegroundColor Cyan
    $certificateSettings = @{
        Type = 'SSLServerAuthentication'
        Subject = "CN=Cricket LAN Development ($LanIP)"
        TextExtension = @("2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=$LanIP")
        CertStoreLocation = 'Cert:\CurrentUser\My'
        KeyAlgorithm = 'RSA'
        KeyLength = 2048
        HashAlgorithm = 'SHA256'
        KeyExportPolicy = 'Exportable'
        NotAfter = (Get-Date).AddMonths(6)
    }
    $cert=New-SelfSignedCertificate @certificateSettings
    if (-not $cert) { throw "Windows failed to generate a local TLS certificate." }
    $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes=New-Object byte[] 48
        $rng.GetBytes($bytes)
        $plain=[Convert]::ToBase64String($bytes)
    } finally { $rng.Dispose() }
    $password=ConvertTo-SecureString $plain -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
    $password | ConvertFrom-SecureString | Set-Content -LiteralPath $secretPath -Encoding UTF8
    $LanIP | Set-Content -LiteralPath $ipPath -Encoding UTF8
    $plain=$null
    Write-Host ""
    Write-Host "Certificate generated; thumbprint: $($cert.Thumbprint)" -ForegroundColor Yellow
    Write-Host "Only trust this certificate on devices you control for local development."
    $answer=Read-Host "Trust this new certificate for your CURRENT Windows user on this PC? Type YES"
    if ($answer -ceq 'YES') {
        Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
        Write-Host "Trusted for current user on this PC." -ForegroundColor Green
    } else {
        Write-Host "Skipped trust: camera/microphone may remain blocked until you trust it."
    }
}
$publicCert=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cerPath)
Write-Host ""
Write-Host "Cricket LAN HTTPS" -ForegroundColor Cyan
Write-Host "URL: https://$($LanIP):$Port"
Write-Host "Local: https://localhost:$Port"
Write-Host "Public certificate: $cerPath"
Write-Host "Fingerprint (verify on the second device): $($publicCert.Thumbprint)"
Write-Host ""
Write-Host "SECOND WINDOWS DEVICE (one-time setup):"
Write-Host "  1. Copy ONLY cricket-lan.cer to the other device."
Write-Host "  2. Verify the certificate fingerprint matches the host."
Write-Host "  3. Double-click the .cer > Install Certificate > Current User >"
Write-Host "     Trusted Root Certification Authorities > Finish."
Write-Host "  4. Restart Chrome/Edge and visit https://$($LanIP):$Port"
Write-Host ""
Write-Host "NEVER copy the .pfx or .dpapi private key files or use this"
Write-Host "certificate to host a real public Cricket deployment."
Write-Host ""
$originalHost=$env:HOST
$originalPort=$env:PORT
$originalPfx=$env:CRICKET_TLS_PFX
$originalPfxPass=$env:CRICKET_TLS_PFX_PASSWORD
try {
    $securePassword=Get-Content -LiteralPath $secretPath -Raw | ConvertTo-SecureString
    $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $env:CRICKET_TLS_PFX_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $env:CRICKET_TLS_PFX=$pfxPath
    $env:HOST='0.0.0.0'
    $env:PORT=[string]$Port
    Write-Host "Starting Cricket over HTTPS (Ctrl+C to stop)..." -ForegroundColor Green
    & npm.cmd start
} finally {
    $env:HOST=$originalHost
    $env:PORT=$originalPort
    $env:CRICKET_TLS_PFX=$originalPfx
    $env:CRICKET_TLS_PFX_PASSWORD=$originalPfxPass
}
