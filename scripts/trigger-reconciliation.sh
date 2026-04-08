#!/bin/bash
set -euo pipefail

# Get API endpoint
API_ENDPOINT="https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/api"

echo "🔄 Triggering workstation reconciliation..."
echo "API Endpoint: ${API_ENDPOINT}/workstations/reconcile"
echo ""
echo "This will create DynamoDB records for any EC2 instances with WorkstationId tag"
echo ""

# Instructions for the user
echo "To run reconciliation, you need an auth token from your browser:"
echo ""
echo "1. Log into the workstation management UI"
echo "2. Open browser Developer Tools (F12)"
echo "3. Go to Console tab and run:"
echo ""
echo "fetch('${API_ENDPOINT}/workstations/reconcile', {"
echo "  method: 'PUT',"
echo "  headers: {"
echo "    'Authorization': 'Bearer ' + localStorage.getItem('authToken')"
echo "  }"
echo "}).then(r => r.json()).then(data => {"
echo "  console.log('Reconciliation Result:', data);"
echo "  alert('Reconciliation completed! Check console for details.');"
echo "})"
echo ""
echo "Or you can invoke the Lambda function directly:"
echo ""
echo "aws lambda invoke --function-name MediaWorkstation-EC2Management \\"
echo "  --payload '{\"httpMethod\":\"PUT\",\"path\":\"/workstations/reconcile\",\"requestContext\":{\"authorizer\":{\"claims\":{\"email\":\"user@example.com\"}}}}' \\"
echo "  response.json && cat response.json"