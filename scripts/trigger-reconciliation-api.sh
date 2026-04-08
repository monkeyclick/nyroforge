#!/bin/bash
set -euo pipefail

# This script triggers the workstation reconciliation API endpoint
# It requires you to be logged into the web app to get the auth token

echo "=== Workstation Reconciliation Script ==="
echo ""
echo "This will sync EC2 instances with DynamoDB records"
echo ""
echo "To trigger reconciliation:"
echo "1. Open the web app and log in"
echo "2. Open browser DevTools Console (F12)"
echo "3. Run this command:"
echo ""
echo "fetch('https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/api/workstations/reconcile', {"
echo "  method: 'PUT',"
echo "  headers: {"
echo "    'Authorization': 'Bearer ' + (await (await fetch('https://cognito-idp.us-west-2.amazonaws.com')).text())"
echo "  }"
echo "}).then(r => r.json()).then(console.log)"
echo ""
echo "Or copy your ID token from localStorage and run:"
echo ""
echo "TOKEN='YOUR_ID_TOKEN_HERE'"
echo "curl -X PUT 'https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/api/workstations/reconcile' \\"
echo "  -H 'Authorization: Bearer \$TOKEN'"
echo ""