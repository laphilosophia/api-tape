#!/bin/bash

# Hybrid Fallback Example

echo "1. Cleaning up previous tapes..."
rm -rf ./tapes

echo "2. Starting API Tape in HYBRID mode..."
echo "Mode: Hybrid (Replay if found, otherwise Proxy & Record)"
echo ""

# Run in background
node ../../dist/index.js serve --target https://jsonplaceholder.typicode.com --port 8080 --dir ./tapes --mode hybrid --record-on-miss true &
PROXY_PID=$!

echo "Waiting for server to start..."
sleep 3

echo "3. Making a request (MISS -> Proxy -> Record)..."
RESPONSE1=$(curl -s http://localhost:8080/users/1)
NAME1=$(echo $RESPONSE1 | sed -n 's/.*"name": "\([^"]*\)".*/\1/p')
echo "User 1 Name: $NAME1"

echo "4. Making the same request (HIT -> Replay)..."
RESPONSE2=$(curl -s http://localhost:8080/users/1)
NAME2=$(echo $RESPONSE2 | sed -n 's/.*"name": "\([^"]*\)".*/\1/p')
echo "User 1 Replayed Name: $NAME2"

echo "5. Verifying tape creation..."
ls ./tapes/*.json

echo "Stopping proxy..."
kill $PROXY_PID
echo "Done."
