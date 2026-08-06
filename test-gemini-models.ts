import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Không tìm thấy GEMINI_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const modelsToTest = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
];

async function testModels() {
  console.log('Đang quét tìm Model hoạt động được với API Key này...\n');
  let workingModel = null;

  for (const modelName of modelsToTest) {
    try {
      process.stdout.write(`Đang thử model: ${modelName}... `);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: 'Say hello in 1 word',
      });
      console.log('✅ THÀNH CÔNG! Trả lời:', response.text?.trim());
      if (!workingModel) workingModel = modelName;
    } catch (e: any) {
      if (e.message?.includes('429')) {
        console.log('❌ THẤT BẠI (Limit 0 / Quota Exceeded)');
      } else {
        console.log('❌ THẤT BẠI (Lỗi khác:', e.message, ')');
      }
    }
  }

  if (workingModel) {
    console.log(`\n🎉 Đã tìm ra model hoàn hảo cho bạn: ${workingModel}`);
  } else {
    console.log('\n🚨 TẤT CẢ MODEL ĐỀU BỊ KHÓA QUOTA (LIMIT: 0).');
  }
}

testModels();
