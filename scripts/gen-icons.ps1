# Generates PWA icons for Sequence (poker-chip design) using GDI+.
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\client\public"

function New-Icon([int]$size, [string]$path, [double]$chipScale) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # felt background
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 29, 74, 58),
        [System.Drawing.Color]::FromArgb(255, 13, 31, 26),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillRectangle($bg, $rect)

    # blue chip
    $m = [int]($size * (1 - $chipScale) / 2)
    $d = $size - 2 * $m
    $chipRect = New-Object System.Drawing.Rectangle($m, $m, $d, $d)
    $chip = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $chipRect,
        [System.Drawing.Color]::FromArgb(255, 96, 165, 250),
        [System.Drawing.Color]::FromArgb(255, 30, 58, 138),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillEllipse($chip, $chipRect)

    # molded inner ring
    $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 255, 255, 255), [Math]::Max(2, $size * 0.018))
    $rm = [int]($m + $d * 0.14)
    $rd = [int]($d * 0.72)
    $g.DrawEllipse($ringPen, $rm, $rm, $rd, $rd)

    # letter S
    $fontSize = [single]($size * 0.34)
    $font = New-Object System.Drawing.Font("Georgia", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 250, 245))
    $textRect = New-Object System.Drawing.RectangleF(0, [single]($size * 0.005), [single]$size, [single]$size)
    $g.DrawString("S", $font, $white, $textRect, $fmt)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "wrote $path"
}

New-Icon 512 (Join-Path $outDir "icon-512.png") 0.86
New-Icon 192 (Join-Path $outDir "icon-192.png") 0.86
New-Icon 180 (Join-Path $outDir "apple-touch-icon.png") 0.86
New-Icon 512 (Join-Path $outDir "icon-maskable-512.png") 0.62
