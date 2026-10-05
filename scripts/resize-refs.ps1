Add-Type -AssemblyName System.Drawing

$files = @(
  'ChatGPT Image Sep 26, 2026, 02_51_44 PM',
  'ChatGPT Image Sep 26, 2026, 02_48_41 PM'
)

foreach ($f in $files) {
  $src = Join-Path 'C:\Users\VIGNESH\Downloads' ($f + '.png')
  if (-not (Test-Path $src)) {
    Write-Host "missing: $src"
    continue
  }
  $img = [System.Drawing.Image]::FromFile($src)
  $w = 800
  $h = [int]($img.Height * $w / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)
  $out = Join-Path $env:TEMP ($f + '-small.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $img.Dispose()
  Write-Host "saved: $out ($([int]((Get-Item $out).Length/1KB)) KB)"
}
