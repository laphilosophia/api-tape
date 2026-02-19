#!/bin/bash

# Body-Aware Matching Example

echo "1. Cleaning up previous tapes..."
rm -rf ./tapes

echo "2. Starting API Tape with BODY-AWARE strategy..."
echo "Strategy: body-aware (Hashes body to differentiate requests)"
echo ""

# Run in background
node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode record --match-strategy body-aware &
PROXY_PID=$!

echo "Waiting for server to start..."
sleep 3

echo "3. Posting variation A..."
BODY_A='{"title":"Post A","body":"Content A","userId":1}'
RES_A=$(curl -s -X POST -H "Content-Type: application/json" -d "$BODY_A" http://localhost:8080/posts)
ID_A=$(echo $RES_A | sed -n 's/.*"id": \([0-9]*\).*/\1/p')
echo "Response A ID: $ID_A"

echo "4. Posting variation B (Same URL, different body)..."
BODY_B='{"title":"Post B","body":"Content B","userId":1}'
RES_B=$(curl -s -X POST -H "Content-Type: application/json" -d "$BODY_B" http://localhost:8080/posts)
ID_B=$(echo $RES_B | sed -n 's/.*"id": \([0-9]*\).*/\1/p')
echo "Response B ID: $ID_B"

echo ""
echo "5. Verifying unique tapes created (should be 2)..."
ls ./tapes/*.json

echo "Stopping proxy..."
kill $PROXY_PID
echo "Done."
