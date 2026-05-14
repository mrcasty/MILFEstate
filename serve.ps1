$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://localhost:8080/")
$Listener.Start()
Write-Host "Serving on http://localhost:8080/"

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".webp" = "image/webp"
    ".svg"  = "image/svg+xml"
    ".csv"  = "text/csv; charset=utf-8"
    ".ico"  = "image/x-icon"
}

while ($Listener.IsListening) {
    $context = $Listener.GetContext()
    $resp = $context.Response
    $path = $context.Request.Url.LocalPath

    try {
        if ($path -eq "/") { $path = "/index.html" }
        $filePath = Join-Path $PSScriptRoot ($path -replace '/', '\')
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [IO.Path]::GetExtension($filePath).ToLower()
            if ($mimeTypes.ContainsKey($ext)) {
                $resp.ContentType = $mimeTypes[$ext]
            }
            $bytes = [IO.File]::ReadAllBytes($filePath)
            $resp.ContentLength64 = $bytes.Length
            $resp.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $resp.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $resp.OutputStream.Write($msg, 0, $msg.Length)
        }
    } catch {
        Write-Host "Error: $_"
        try { $resp.StatusCode = 500 } catch {}
    } finally {
        $resp.OutputStream.Close()
    }
}
