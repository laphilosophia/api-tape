# Hybrid Fallback Example

echo "1. Cleaning up previous tapes..."
Remove-Item -Path ./tapes -Recurse -Force -ErrorAction SilentlyContinue

echo "2. Starting API Tape in HYBRID mode..."
echo "Mode: Hybrid (Replay if found, otherwise Proxy & Record)"
echo ""

# Run in background
$job = Start-Job -ScriptBlock {
    node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode hybrid --record-on-miss true
}

echo "Waiting for server to start..."
Start-Sleep -Seconds 3

echo "3. Making a request (MISS -> Proxy -> Record)..."
$response1 = Invoke-RestMethod -Uri http://localhost:8080/users/1
echo "User 1 Name: $($response1.name)"

echo "4. Making the same request (HIT -> Replay)..."
$response2 = Invoke-RestMethod -Uri http://localhost:8080/users/1
echo "User 1 Replayed Name: $($response2.name)"

echo "5. Verifying tape creation..."
Get-ChildItem ./tapes/*.json | Select-Object Name

echo "Stopping proxy..."
Stop-Job $job
echo "Done."
