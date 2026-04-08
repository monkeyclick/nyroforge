#!/bin/bash
set -e

echo "=========================================="
echo "Building Next.js Frontend"
echo "=========================================="

cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm ci
else
    echo "Dependencies already installed"
fi

# Clean previous build
echo "Cleaning previous build..."
rm -rf .next out

# Build Next.js static export
echo "Building Next.js application..."
npm run build

# Verify build output
if [ -d "out" ]; then
    echo "✓ Build successful!"
    echo "✓ Static files generated in frontend/out/"
    ls -lh out/ | head -10
else
    echo "✗ Build failed - out directory not found"
    exit 1
fi

echo "=========================================="
echo "Frontend build complete!"
echo "=========================================="