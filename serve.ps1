$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://localhost:8080/")
$Listener.Start()
while ($Listener.IsListening) {
    $context = $Listener.GetContext()
    $response = $context.Response
    $html = Get-Content "index2.html" -Raw
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()
}