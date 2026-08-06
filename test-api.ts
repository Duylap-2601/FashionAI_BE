import axios from 'axios';

/**
 * Test script để kiểm tra API Virtual Try-On
 * Chạy server trước: npm run start:dev
 * Sau đó: npx ts-node test-api.ts
 */

const API_URL = 'http://localhost:3000/api/try-on';

// Ví dụ URLs (thay bằng URLs thực tế)
const TEST_CASES = [
  {
    name: 'Valid Request',
    payload: {
      humanImageUrl: 'https://example.com/person.jpg',
      garmentImageUrl: 'https://example.com/shirt.jpg',
    },
    expectedStatus: 200,
  },
  {
    name: 'Missing humanImageUrl',
    payload: {
      garmentImageUrl: 'https://example.com/shirt.jpg',
    },
    expectedStatus: 400,
  },
  {
    name: 'Invalid URL - humanImageUrl',
    payload: {
      humanImageUrl: 'not-a-url',
      garmentImageUrl: 'https://example.com/shirt.jpg',
    },
    expectedStatus: 400,
  },
  {
    name: 'Invalid URL - garmentImageUrl',
    payload: {
      humanImageUrl: 'https://example.com/person.jpg',
      garmentImageUrl: 'invalid-url',
    },
    expectedStatus: 400,
  },
  {
    name: 'Extra fields (should be rejected)',
    payload: {
      humanImageUrl: 'https://example.com/person.jpg',
      garmentImageUrl: 'https://example.com/shirt.jpg',
      extraField: 'should be removed',
    },
    expectedStatus: 400,
  },
];

/**
 * Test API endpoint
 */
async function testAPI() {
  console.log('🚀 Bắt đầu test API Try-On...\n');

  for (const testCase of TEST_CASES) {
    try {
      console.log(`📌 Test: ${testCase.name}`);
      console.log(`   Payload:`, JSON.stringify(testCase.payload, null, 2));

      const response = await axios.post(API_URL, testCase.payload);

      console.log(`   ✅ Status: ${response.status}`);
      console.log(`   Response:`, JSON.stringify(response.data, null, 2));

      if (response.status === testCase.expectedStatus) {
        console.log(`   ✓ Expected status ${testCase.expectedStatus} - PASS\n`);
      } else {
        console.log(
          `   ✗ Expected ${testCase.expectedStatus} but got ${response.status} - FAIL\n`,
        );
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.log(`   ❌ Status: ${error.response?.status}`);
        console.log(`   Error:`, JSON.stringify(error.response?.data, null, 2));

        if (error.response?.status === testCase.expectedStatus) {
          console.log(`   ✓ Expected status ${testCase.expectedStatus} - PASS\n`);
        } else {
          console.log(
            `   ✗ Expected ${testCase.expectedStatus} but got ${error.response?.status} - FAIL\n`,
          );
        }
      } else {
        console.log(`   ❌ Unexpected error:`, error);
        console.log('');
      }
    }
  }

  console.log('✨ Test hoàn thành!\n');
}

/**
 * Test timeout behavior
 */
async function testTimeout() {
  console.log('⏱️  Test Timeout Behavior...\n');

  try {
    const response = await axios.post(
      API_URL,
      {
        humanImageUrl: 'https://example.com/person.jpg',
        garmentImageUrl: 'https://example.com/shirt.jpg',
      },
      { timeout: 5000 }, // 5 second timeout
    );

    console.log('✅ Request completed within 5 seconds');
    console.log(`Response:`, JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        console.log('⏱️  Request timeout (expected behavior)');
      } else {
        console.log(`❌ Error: ${error.response?.status}`);
        console.log(`Details:`, error.response?.data);
      }
    }
  }
}

/**
 * Test concurrent requests
 */
async function testConcurrency() {
  console.log('🔄 Test Concurrent Requests (5 requests at once)...\n');

  const requests = Array.from({ length: 5 }).map((_, i) =>
    axios
      .post(API_URL, {
        humanImageUrl: 'https://example.com/person.jpg',
        garmentImageUrl: 'https://example.com/shirt.jpg',
      })
      .then((res) => {
        console.log(`  Request ${i + 1}: ✅ Success (${res.status})`);
      })
      .catch((err) => {
        console.log(
          `  Request ${i + 1}: ❌ Error (${err.response?.status || err.code})`,
        );
      }),
  );

  await Promise.all(requests);
  console.log('\n');
}

/**
 * Main test runner
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('   AI Fashion Try-On API - Test Suite');
  console.log('═'.repeat(60));
  console.log('');

  // Test 1: Validation
  await testAPI();

  // Test 2: Timeout (uncomment nếu muốn test)
  // await testTimeout();

  // Test 3: Concurrency (uncomment nếu muốn test)
  // await testConcurrency();

  console.log('═'.repeat(60));
  console.log('   Test Suite Complete');
  console.log('═'.repeat(60));
}

main().catch(console.error);
