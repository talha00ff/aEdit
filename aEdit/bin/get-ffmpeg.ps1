# Downloads a Windows ffmpeg build and copies ffmpeg.exe into the aEdit panel.
param([string]$Dest)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$urls = @(
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
)
$zip = Join-Path $env:TEMP 'aedit_ffmpeg.zip'
$tmp = Join-Path $env:TEMP 'aedit_ffmpeg'
foreach ($u in $urls) {
  try {
    Write-Host "  Downloading ffmpeg from $u ..."
    Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $exe = Get-ChildItem $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
    if (-not $exe) { throw 'ffmpeg.exe not found in archive' }
    New-Item -ItemType Directory -Force -Path (Join-Path $Dest 'bin') | Out-Null
    Copy-Item $exe.FullName (Join-Path $Dest 'bin\ffmpeg.exe') -Force
    Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  ffmpeg installed.'
    exit 0
  } catch { Write-Host "  Failed: $($_.Exception.Message)" }
}
exit 1
