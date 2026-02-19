#!/bin/bash

# Redaction Example

echo "1. Cleaning up previous tapes..."
rm -rf ./tapes

echo "2. Starting API Tape with REDACTION..."
echo "Redacting Header: x-powered-by"
echo "Redacting JSON Path: company.name"
echo ""

# Run in background
node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode record --redact-header "x-powered-by" --redact-json-path "company.name" &
PROXY_PID=$!

echo "Waiting for server to start..."
sleep 3

echo "3. Making a request..."
curl -s -i http://localhost:8080/users/1 > /dev/null

echo ""
echo "4. Checking results in the recorded tape..."
TAPE_FILE=$(ls ./tapes/*.json | head -n 1)

echo "--- REDACTION RESULTS ---"
echo "Header 'x-powered-by': $(grep "x-powered-by" "$TAPE_FILE")"
# Extracting the redacted body value (simplistic regex for example)
echo "JSON path 'company.name': $(grep "company.name" "$TAPE_FILE")"

echo "Stopping proxy..."
kill $PROXY_PID
echo "Done."
