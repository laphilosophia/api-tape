# Basic Recording Example

echo "1. Cleaning up previous tapes..."
Remove-Item -Path ./tapes -Recurse -Force -ErrorAction SilentlyContinue

echo "2. Starting API Tape in RECORD mode..."
echo "Target: https://jsonplaceholder.typicode.com"
echo "Proxy: http://localhost:8080"
echo ""

# Run in background
$job = Start-Job -ScriptBlock {
    node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode record
}

echo "Waiting for server to start..."
Start-Sleep -Seconds 3

echo "3. Making a request through the proxy..."
$response = Invoke-RestMethod -Uri http://localhost:8080/posts/1
echo "Response Title: $($response.title)"

echo "Stopping proxy..."
Stop-Job $job

echo ""
echo "4. Tape created in ./tapes directory:"
Get-ChildItem ./tapes/*.json | Select-Object Name

echo ""
echo "5. Starting API Tape in REPLAY mode..."
# REPLAY mode is the default
$job = Start-Job -ScriptBlock {
    node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode replay
}

Start-Sleep -Seconds 2

echo "6. Making the same request (it will be served from tape)..."
$response = Invoke-RestMethod -Uri http://localhost:8080/posts/1
echo "Replayed Response Title: $($response.title)"

echo "Stopping proxy..."
Stop-Job $job
echo "Done."
