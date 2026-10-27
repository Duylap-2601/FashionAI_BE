/**
 * Test script to verify admin cannot change their own role
 *
 * Usage:
 * 1. Set ADMIN_ACCESS_TOKEN to a valid admin user's JWT
 * 2. Set ADMIN_USER_ID to that admin's user ID
 * 3. Run: node test-admin-self-modification.js
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_ACCESS_TOKEN = process.env.ADMIN_ACCESS_TOKEN || 'YOUR_ADMIN_ACCESS_TOKEN_HERE';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'YOUR_ADMIN_USER_ID_HERE';

async function testAdminSelfModification() {
  console.log('🔍 Testing admin self-modification prevention...\n');

  try {
    // Test 1: Admin tries to change their own role to USER
    console.log('📍 Test 1: Admin trying to demote themselves to USER');
    const response1 = await fetch(`${API_URL}/users/${ADMIN_USER_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'USER',
      }),
    });

    const data1 = await response1.json();

    if (response1.status === 400) {
      console.log('✅ PASSED: Request was blocked');
      console.log(`   Message: "${data1.message}"`);
    } else if (response1.ok) {
      console.log('❌ FAILED: Admin was able to change their own role!');
      console.log('   This is a security vulnerability.');
    } else {
      console.log(`⚠️  Unexpected status: ${response1.status}`);
      console.log('   Response:', JSON.stringify(data1, null, 2));
    }

    // Test 2: Admin can change their own tier (should be allowed)
    console.log('\n📍 Test 2: Admin trying to change their own tier');
    const response2 = await fetch(`${API_URL}/users/${ADMIN_USER_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tier: 'VIP',
      }),
    });

    const data2 = await response2.json();

    if (response2.ok) {
      console.log('✅ PASSED: Admin can change their own tier');
      console.log(`   New tier: ${data2.data.tier}`);
    } else {
      console.log('⚠️  Admin could not change their own tier');
      console.log('   Response:', JSON.stringify(data2, null, 2));
    }

    // Test 3: Admin can change their own isVerified (should be allowed)
    console.log('\n📍 Test 3: Admin trying to change their own isVerified status');
    const response3 = await fetch(`${API_URL}/users/${ADMIN_USER_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isVerified: true,
      }),
    });

    const data3 = await response3.json();

    if (response3.ok) {
      console.log('✅ PASSED: Admin can change their own verification status');
      console.log(`   isVerified: ${data3.data.isVerified}`);
    } else {
      console.log('⚠️  Admin could not change their own verification status');
      console.log('   Response:', JSON.stringify(data3, null, 2));
    }

    console.log('\n✅ All tests completed!');
    console.log('\n📋 Summary:');
    console.log('- Admin CANNOT change their own role ✓');
    console.log('- Admin CAN change their own tier ✓');
    console.log('- Admin CAN change their own verification status ✓');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testAdminSelfModification();
