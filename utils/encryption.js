import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const Algorithm = 'aes-256-cbc';
const Key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
const IV_LENGTH = 16; // AES block size

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    console.error("FATAL: ENCRYPTION_KEY missing or invalid in .env! Must be 64 hex chars (32 bytes).");
}

/**
 * Encrypts a text string using AES-256-CBC.
 * Returns IV:EncryptedData
 */
export const encrypt = (text) => {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(Algorithm, Key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

/**
 * Decrypts a text string.
 */
export const decrypt = (text) => {
    if (!text) return text;
    // Check if text is encrypted format (iv:data)
    if (!text.includes(':')) return text; // Probably legacy plain text

    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(Algorithm, Key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error("Encryption Error (Decrypt): Data might be corrupted or key changed.", e);
        return text; // Return original if fail (fail-safe for legacy data mixed)
    }
};

/**
 * Hashes a field for searchable blind index (e.g. searching by CNPJ).
 * Uses SHA-256. This is deterministic (same input = same output).
 */
export const hashField = (text) => {
    if (!text) return text;
    // Normalize before hashing (e.g. remove non-digits) to ensure consistent search
    const normalized = text.toString().trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
};
