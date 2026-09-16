/**
 * Test script to verify admin user name is returned correctly
 *
 * Usage:
 * 1. Set ACCESS_TOKEN to a valid admin user's JWT
 * 2. Run: node test-admin-user.js
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'YOUR_ADMIN_ACCESS_TOKEN_HERE';

async function testAdminUser() {
  console.log('🔍 Testing admin user API response...\n');

  try {
    // Test GET /users/me
    console.log('📍 Testing GET /users/me');
    const meResponse = await fetch(`${API_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
    });

    if (!meResponse.ok) {
      console.error('❌ Failed to fetch user profile:', meResponse.status, meResponse.statusText);
      process.exit(1);
    }

    const meData = await meResponse.json();
    console.log('✅ Response received\n');
    console.log('User data:', JSON.stringify(meData.data, null, 2));

    // Verify the response
    console.log('\n📊 Verification:');
    console.log(`- Name: "${meData.data.name}"`);
    console.log(`- Email: "${meData.data.email}"`);
    console.log(`- Role: "${meData.data.role}"`);
    console.log(`- Tier: "${meData.data.tier}"`);

    if (meData.data.role === 'ADMIN') {
      console.log('\n✅ User has ADMIN role');
      if (meData.data.name && meData.data.name !== 'Admin fashionAI (quản trị viên)') {
        console.log(`✅ Name is correctly set to: "${meData.data.name}"`);
      } else if (meData.data.name === 'Admin fashionAI (quản trị viên)') {
        console.log('⚠️  Name is hardcoded in DATABASE as "Admin fashionAI (quản trị viên)"');
        console.log('    You need to update the name in the database using PATCH /users/:id');
      } else {
        console.log('⚠️  Name is empty or null');
      }
    } else {
      console.log('\n⚠️  User does not have ADMIN role');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testAdminUser();
