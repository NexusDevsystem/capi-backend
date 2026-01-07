import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.GEMINI_API_KEY;
console.log("Checking API Key availability...");

if (!key) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing in process.env");
    process.exit(1);
} else {
    console.log("✅ API Key found (starts with: " + key.substring(0, 5) + "...)");
}

async function testModel(modelName) {
    console.log(`\nTesting model: ${modelName}...`);
    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, reply with 'OK'");
        const response = result.response.text();
        console.log(`✅ SUCCESS with ${modelName}: ${response}`);
        return true;
    } catch (e) {
        console.error(`❌ FAILED with ${modelName}:`);
        console.error(e.message);
        return false;
    }
}

async function run() {
    // Test the one used in server.js first
    const mainModel = "gemini-2.0-flash";
    const works = await testModel(mainModel);

    if (!works) {
        console.log("\n⚠️ Main model failed. Testing alternatives...");
        await testModel("gemini-1.5-flash");
        await testModel("gemini-pro");
    }
}

run();
