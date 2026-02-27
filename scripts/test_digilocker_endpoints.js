#!/usr/bin/env node

/**
 * DigiLocker Profile Endpoint Tester
 * 
 * This script tests different DigiLocker profile endpoints to find the correct one.
 * Run after obtaining an access token from the OAuth flow.
 */

const ENDPOINTS_TO_TEST = [
  'https://digilocker.meripehchaan.gov.in/public/oauth2/3/user',
  'https://digilocker.meripehchaan.gov.in/public/oauth2/1/user',
  'https://digilocker.meripehchaan.gov.in/public/oauth2/3/userinfo',
  'https://digilocker.meripehchaan.gov.in/public/oauth2/1/userinfo',
  'https://digilocker.meripehchaan.gov.in/public/oauth2/1/profile', // Current (failing)
];

async function testEndpoint(url, accessToken) {
  console.log(`\n🧪 Testing: ${url}`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const contentType = response.headers.get('content-type');
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${contentType}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ SUCCESS - Data received:`, JSON.stringify(data, null, 2));
      return { success: true, url, data };
    } else {
      const errorText = await response.text();
      console.log(`   ❌ FAILED - Error: ${errorText}`);
      return { success: false, url, error: errorText };
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    return { success: false, url, error: error.message };
  }
}

async function main() {
  const accessToken = process.argv[2];

  if (!accessToken) {
    console.error('❌ Usage: node test_digilocker_endpoints.js <ACCESS_TOKEN>');
    console.error('');
    console.error('To get an access token:');
    console.error('1. Start KYC flow from tenant portal');
    console.error('2. Check Netlify function logs for the access_token');
    console.error('3. Run this script with that token');
    process.exit(1);
  }

  console.log('🔍 Testing DigiLocker Profile Endpoints');
  console.log('==========================================');
  console.log(`Access Token: ${accessToken.substring(0, 20)}...`);

  const results = [];
  for (const endpoint of ENDPOINTS_TO_TEST) {
    const result = await testEndpoint(endpoint, accessToken);
    results.push(result);
  }

  console.log('\n\n📊 SUMMARY');
  console.log('==========================================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length > 0) {
    console.log('\n✅ Working Endpoints:');
    successful.forEach(r => {
      console.log(`   ${r.url}`);
    });
    console.log('\n💡 Recommendation: Update DIGILOCKER_PROFILE_ENDPOINT to:');
    console.log(`   ${successful[0].url}`);
  } else {
    console.log('\n❌ No working endpoints found!');
    console.log('   Possible issues:');
    console.log('   - Access token expired or invalid');
    console.log('   - DigiLocker API changed');
    console.log('   - Network/firewall issues');
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed Endpoints:');
    failed.forEach(r => {
      console.log(`   ${r.url} - ${r.error}`);
    });
  }
}

main();
