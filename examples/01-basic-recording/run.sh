#!/bin/bash

# Basic Recording Example

echo "1. Cleaning up previous tapes..."
rm -rf ./tapes

echo "2. Starting API Tape in RECORD mode..."
echo "Target: https://jsonplaceholder.typicode.com"
echo "Proxy: http://localhost:8080"
echo ""

# Run in background
node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode record &
PROXY_PID=$!

echo "Waiting for server to start..."
sleep 3

echo "3. Making a request through the proxy..."
RESPONSE=$(curl -s http://localhost:8080/posts/1)
TITLE=$(echo $RESPONSE | sed -n 's/.*"title": "\([^"]*\)".*/\1/p')
echo "Response Title: $TITLE"

echo "Stopping proxy..."
kill $PROXY_PID

echo ""
echo "4. Tape created in ./tapes directory:"
ls ./tapes/*.json

echo ""
echo "5. Starting API Tape in REPLAY mode..."
node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8081 --dir ./tapes --mode replay &
PROXY_PID=$!

sleep 2

echo "6. Making the same request (served from tape)..."
RESPONSE=$(curl -s http://localhost:8081/posts/1)
TITLE=$(echo $RESPONSE | sed -n 's/.*"title": "\([^"]*\)".*/\1/p')
echo "Replayed Response Title: $TITLE"

echo "Stopping proxy..."
kill $PROXY_PID
echo "Done."
