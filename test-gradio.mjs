import { client } from '@gradio/client';
import * as dotenv from 'dotenv';
import * as EventSourcePkg from 'eventsource';

// Polyfill EventSource cho Node.js để Gradio client không bị lỗi
global.EventSource = EventSourcePkg.default || EventSourcePkg.EventSource || EventSourcePkg;

dotenv.config();

const MOCK_DATA = {
  humanImageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
  garmentImageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
};

async function testGradio() {
  console.log('🚀 Đang kết nối tới mô hình AI...');
  
  const options = {};
  if (process.env.HF_TOKEN) {
    options.hf_token = process.env.HF_TOKEN;
    console.log('✅ Đã load HF_TOKEN');
  }

  try {
    const app = await client('Kwai-Kolors/Kolors-Virtual-Try-On', options);
    console.log('✅ Kết nối thành công! Đang gửi ảnh (có thể mất 1-2 phút)...');

    const startTime = Date.now();
    
    // Không dùng name '/tryon' vì API này bị ẩn (api_name: false), phải dùng fn_index: 2
    // và theo config thì nó chỉ nhận 4 tham số: person, garment, seed, random_seed
    const result = await app.predict(2, [
      MOCK_DATA.humanImageUrl,    // id:11 - person image
      MOCK_DATA.garmentImageUrl,  // id:14 - garment image
      0,                          // id:19 - seed
      true                        // id:20 - random seed
    ]);

    const endTime = Date.now();
    console.log(`\n🎉 HOÀN THÀNH trong ${((endTime - startTime)/1000).toFixed(1)}s!`);
    console.log('\n📦 Kết quả raw từ AI:');
    console.log(JSON.stringify(result.data, null, 2));

    // Lấy URL ảnh kết quả (Thường nằm trong result.data[0].url)
    const outputUrl = result.data?.[0]?.url;
    if (outputUrl) {
      console.log('\n👉 LINK ẢNH KẾT QUẢ CỦA BẠN ĐÂY:');
      console.log(outputUrl);
    }

  } catch (error) {
    console.error('\n❌ LỖI RỒI:');
    console.error(error);
  }
}

testGradio();
