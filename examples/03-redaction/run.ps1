# Redaction Example

echo "1. Cleaning up previous tapes..."
Remove-Item -Path ./tapes -Recurse -Force -ErrorAction SilentlyContinue

echo "2. Starting API Tape with REDACTION..."
echo "Redacting Header: x-powered-by"
echo "Redacting JSON Path: company.name"
echo ""

# Run in background
$job = Start-Job -ScriptBlock {
    node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode record --redact-header "x-powered-by" --redact-json-path "company.name"
}

echo "Waiting for server to start..."
Start-Sleep -Seconds 3

echo "3. Making a request..."
$response = Invoke-WebRequest -Uri http://localhost:8080/users/1
$data = $response.Content | ConvertFrom-Json

echo ""
echo "4. Checking results in the recorded tape..."
$tapeFile = Get-ChildItem ./tapes/*.json | Select-Object -First 1
$tape = Get-Content $tapeFile.FullName | ConvertFrom-Json

echo "--- REDACTION RESULTS ---"
echo "Header 'x-powered-by': $($tape.headers.'x-powered-by')"
echo "JSON path 'company.name': $($tape.body | ForEach-Object { [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($_)) } | ConvertFrom-Json | ForEach-Object { $_.company.name })"

echo "Stopping proxy..."
Stop-Job $job
echo "Done."
