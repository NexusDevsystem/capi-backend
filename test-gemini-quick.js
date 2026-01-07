import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.GEMINI_API_KEY;
console.log("Testing Gemini API Key...");
console.log("Key found:", key ? "YES (starts with " + key.substring(0, 10) + "...)" : "NO");

async function testGeminiPro() {
    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        console.log("\nSending test request to gemini-pro...");
        const result = await model.generateContent("Say 'OK' if you're working");
        const response = result.response.text();

        console.log("✅ SUCCESS! Response:", response);
        return true;
    } catch (e) {
        console.error("❌ FAILED!");
        console.error("Error message:", e.message);
        if (e.response) {
            console.error("Response status:", e.response.status);
            console.error("Response data:", e.response.data);
        }
        return false;
    }
}

testGeminiPro();
