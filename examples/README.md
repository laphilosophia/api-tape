# API Tape Examples

This directory contains practical examples of how to use **API Tape** in various scenarios.

## Prerequisites

- **Node.js**: v18 or later.
- **Build**: Ensure the project is built before running examples.
  ```bash
  npm run build
  ```

## Overview of Examples

1.  **[Basic Recording](./01-basic-recording)**: Record and replay against a public API.
2.  **[Hybrid Fallback](./02-hybrid-fallback)**: Demonstrating the fallback-to-proxy behavior for missing tapes.
3.  **[Data Redaction](./03-redaction)**: Masking sensitive headers and JSON body fields before saving.
4.  **[Body-Aware Matching](./04-body-aware-matching)**: Handling different responses for the same URL but different POST payloads.

## Running Examples

Each example contains a `run.ps1` (for Windows) or `run.sh` (for Unix) script.

```bash
# Example
cd 01-basic-recording
./run.ps1
```
