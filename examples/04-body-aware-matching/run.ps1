# Body-Aware Matching Example

echo "1. Cleaning up previous tapes..."
Remove-Item -Path ./tapes -Recurse -Force -ErrorAction SilentlyContinue

echo "2. Starting API Tape with BODY-AWARE strategy..."
echo "Strategy: body-aware (Hashes body to differentiate requests)"
echo ""

# Run in background
$job = Start-Job -ScriptBlock {
    node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode record --match-strategy body-aware
}

echo "Waiting for server to start..."
Start-Sleep -Seconds 3

echo "3. Posting variation A..."
$bodyA = @{ title = 'Post A'; body = 'Content A'; userId = 1 } | ConvertTo-Json
$resA = Invoke-RestMethod -Method Post -Uri http://localhost:8080/posts -Body $bodyA -ContentType "application/json"
echo "Response A ID: $($resA.id)"

echo "4. Posting variation B (Same URL, different body)..."
$bodyB = @{ title = 'Post B'; body = 'Content B'; userId = 1 } | ConvertTo-Json
$resB = Invoke-RestMethod -Method Post -Uri http://localhost:8080/posts -Body $bodyB -ContentType "application/json"
echo "Response B ID: $($resB.id)"

echo ""
echo "5. Verifying unique tapes created (should be 2)..."
Get-ChildItem ./tapes/*.json | Select-Object Name

echo "Stopping proxy..."
Stop-Job $job
echo "Done."
