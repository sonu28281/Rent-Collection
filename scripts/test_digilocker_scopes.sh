#!/bin/bash

# Test different DigiLocker scope combinations
# Run this to test which scope works

echo "🧪 Testing DigiLocker Scopes"
echo "=============================="
echo ""

SCOPES=(
  "openid"
  "openid profile"
  "openid aadhaar"
  "openid issued:aadhaar"
  "openid org.iso.18013.5.1.mDL"
  "openid digilocker.issued_documents"
)

CLIENT_ID="${DIGILOCKER_CLIENT_ID:-AT561D9B37}"
REDIRECT_URI="${DIGILOCKER_REDIRECT_URI:-https://tenants.callvia.in/kyc/callback}"
AUTH_ENDPOINT="${DIGILOCKER_AUTHORIZATION_ENDPOINT:-https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize}"

echo "Client ID: $CLIENT_ID"
echo "Redirect URI: $REDIRECT_URI"
echo ""
echo "Testing scopes (open each URL in browser):"
echo ""

for scope in "${SCOPES[@]}"; do
  encoded_scope=$(echo -n "$scope" | jq -sRr @uri)
  test_url="${AUTH_ENDPOINT}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${encoded_scope}&state=test_${RANDOM}"
  
  echo "Scope: $scope"
  echo "URL: $test_url"
  echo ""
done

echo "=============================="
echo "Instructions:"
echo "1. Copy each URL above"
echo "2. Open in browser"
echo "3. Try to authenticate"
echo "4. If you see login page → Scope is valid ✅"
echo "5. If you see 'invalid scope' → Scope not allowed ❌"
echo ""
echo "Note which scopes work, then update DIGILOCKER_SCOPES in Netlify"
