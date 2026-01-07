import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.GEMINI_API_KEY;

async function testGemini25Flash() {
    try {
        console.log("Testing gemini-2.5-flash...");
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const result = await model.generateContent("Reply with 'OK' if working");
        const response = result.response.text();

        console.log("✅ SUCCESS! Model is working!");
        console.log("Response:", response);
        return true;
    } catch (e) {
        console.error("❌ FAILED!");
        console.error("Error:", e.message);
        return false;
    }
}

testGemini25Flash();
