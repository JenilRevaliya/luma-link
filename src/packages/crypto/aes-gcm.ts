/**
 * Web Cryptography API: AES-GCM 128-bit Authenticated Encryption and Decryption
 */

export class CryptoEngine {
  public static readonly KEY_LENGTH_BITS = 128;
  public static readonly IV_LENGTH_BYTES = 12;

  /**
   * Generates a random cryptographic AES-GCM key
   */
  public static async generateKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: CryptoEngine.KEY_LENGTH_BITS,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generates a random 12-byte initialization vector (IV)
   */
  public static generateIV(): Uint8Array {
    const iv = new Uint8Array(CryptoEngine.IV_LENGTH_BYTES);
    crypto.getRandomValues(iv);
    return iv;
  }

  /**
   * Exports a CryptoKey to raw byte array
   */
  public static async exportKey(key: CryptoKey): Promise<Uint8Array> {
    const raw = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(raw);
  }

  /**
   * Imports a raw byte array into a CryptoKey
   */
  public static async importKey(rawKey: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      rawKey as unknown as BufferSource,
      {
        name: 'AES-GCM',
        length: CryptoEngine.KEY_LENGTH_BITS,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts plaintext bytes using AES-GCM (producing ciphertext + 16-byte auth tag)
   */
  public static async encrypt(
    plaintext: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
      },
      key,
      plaintext as unknown as BufferSource
    );
    return new Uint8Array(ciphertext);
  }

  /**
   * Authenticates and decrypts ciphertext bytes
   */
  public static async decrypt(
    ciphertext: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
      },
      key,
      ciphertext as unknown as BufferSource
    );
    return new Uint8Array(decrypted);
  }
}
