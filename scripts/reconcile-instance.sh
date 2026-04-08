#!/bin/bash
set -euo pipefail

# Get the API endpoint and token from your deployed stack
API_ENDPOINT="https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/api"

echo "Reconciling workstations..."
echo "This will create DynamoDB records for any EC2 instances with WorkstationId tag"
echo ""

# You need to provide your Cognito auth token
echo "To run reconciliation, execute this in your browser console while logged in:"
echo ""
echo "fetch('${API_ENDPOINT}/workstations/reconcile', {"
echo "  method: 'PUT',"
echo "  headers: {"
echo "    'Authorization': 'Bearer ' + localStorage.getItem('authToken')"  
echo "  }"
echo "}).then(r => r.json()).then(console.log)"
echo ""
echo "Or use the AWS CLI to check if the instance has the required tags:"
echo "aws ec2 describe-instances --instance-ids i-0xxxxxxxxxxxxxxxxx --query 'Reservations[0].Instances[0].Tags'"

