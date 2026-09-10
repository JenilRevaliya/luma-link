import { describe, it, expect } from 'vitest';
import { CryptoEngine } from '../packages/crypto/aes-gcm';

describe('CryptoEngine', () => {
  it('should encrypt and decrypt data with AES-GCM', async () => {
    const key = await CryptoEngine.generateKey();
    const iv = CryptoEngine.generateIV();
    const message = new TextEncoder().encode('LumaLink Optical Transfer Protocol 2026');

    const encrypted = await CryptoEngine.encrypt(message, key, iv);
    expect(encrypted.length).toBeGreaterThan(message.length); // Includes 16-byte GCM tag

    const decrypted = await CryptoEngine.decrypt(encrypted, key, iv);
    expect(new TextDecoder().decode(decrypted)).toBe('LumaLink Optical Transfer Protocol 2026');
  });

  it('should reject tampered ciphertext with authentication failure', async () => {
    const key = await CryptoEngine.generateKey();
    const iv = CryptoEngine.generateIV();
    const message = new TextEncoder().encode('Secret Message');

    const encrypted = await CryptoEngine.encrypt(message, key, iv);
    // Tamper with one byte
    encrypted[2] ^= 0x01;

    await expect(CryptoEngine.decrypt(encrypted, key, iv)).rejects.toThrow();
  });
});
