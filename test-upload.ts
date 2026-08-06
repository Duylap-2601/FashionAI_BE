import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const API_URL = 'http://localhost:3000/api/try-on';

// Sử dụng 2 ảnh mẫu công khai để test
const MOCK_DATA = {
  // Ảnh một người mẫu nam mặc áo trắng
  humanImageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
  // Ảnh một chiếc áo phông đỏ
  garmentImageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
};

async function testRealUpload() {
  console.log('🚀 Bắt đầu test real upload AI Fashion Try-On...');
  console.log(`📸 Ảnh người: ${MOCK_DATA.humanImageUrl}`);
  console.log(`👕 Ảnh áo: ${MOCK_DATA.garmentImageUrl}`);
  console.log('⏳ Đang chờ AI xử lý (có thể mất 30s - 2 phút)...');

  try {
    const startTime = Date.now();
    const response = await axios.post(API_URL, MOCK_DATA, {
      // Timeout 3 phút vì xử lý AI có thể mất thời gian
      timeout: 180000 
    });
    const endTime = Date.now();

    console.log('\n✅ XỬ LÝ THÀNH CÔNG!');
    console.log(`⏱️ Thời gian: ${((endTime - startTime) / 1000).toFixed(1)}s`);
    console.log('📦 Kết quả API:', JSON.stringify(response.data, null, 2));
    
    if (response.data?.data?.resultImageUrl) {
        console.log('\n🎉 >>> LINK ẢNH KẾT QUẢ: <<< 🎉');
        console.log(response.data.data.resultImageUrl);
        console.log('Hãy click vào link trên để xem kết quả!');
    }

  } catch (error) {
    console.error('\n❌ CÓ LỖI XẢY RA!');
    if (axios.isAxiosError(error)) {
      console.error('Status:', error.response?.status);
      console.error('Data:', JSON.stringify(error.response?.data, null, 2));
    } else {
      console.error(error);
    }
  }
}

testRealUpload();
