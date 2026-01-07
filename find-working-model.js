import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const modelsToTest = [
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.0-pro",
    "gemini-pro",
    "models/gemini-pro",
    "models/gemini-1.5-flash"
];

async function testModel(modelName) {
    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Reply with OK");
        console.log(`✅ ${modelName}: SUCCESS - ${result.response.text()}`);
        return true;
    } catch (e) {
        console.log(`❌ ${modelName}: FAILED - ${e.message.substring(0, 80)}`);
        return false;
    }
}

async function findWorkingModel() {
    console.log("Testing models with API key:", key.substring(0, 15) + "...\n");

    for (const modelName of modelsToTest) {
        const works = await testModel(modelName);
        if (works) {
            console.log(`\n🎉 FOUND WORKING MODEL: ${modelName}`);
            return modelName;
        }
    }

    console.log("\n❌ No working models found. Your API key may be invalid or expired.");
    console.log("Please check: https://aistudio.google.com/app/apikey");
}

findWorkingModel();
