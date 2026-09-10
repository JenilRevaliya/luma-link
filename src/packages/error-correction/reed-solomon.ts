/**
 * Galois Field GF(2^8) Reed-Solomon Codec
 * Uses standard primitive polynomial 0x11D (x^8 + x^4 + x^3 + x^2 + 1)
 */

export class ReedSolomon {
  private expTable = new Uint8Array(512);
  private logTable = new Uint8Array(256);
  private generator: Uint8Array;
  public readonly parityBytes: number;

  constructor(parityBytes = 8) {
    this.parityBytes = parityBytes;
    this.initGaloisField();
    this.generator = this.buildGenerator(parityBytes);
  }

  private initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      this.expTable[i] = x;
      this.expTable[i + 255] = x;
      this.logTable[x] = i;
      x <<= 1;
      if (x & 0x100) {
        x ^= 0x11d; // primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
      }
    }
  }

  public gfMul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return this.expTable[this.logTable[a] + this.logTable[b]];
  }

  public gfDiv(a: number, b: number): number {
    if (a === 0) return 0;
    if (b === 0) throw new Error('Division by zero in GF(256)');
    return this.expTable[this.logTable[a] + 255 - this.logTable[b]];
  }

  public gfPolyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
    const res = new Uint8Array(p1.length + p2.length - 1);
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        res[i + j] ^= this.gfMul(p1[i], p2[j]);
      }
    }
    return res;
  }

  private buildGenerator(nParity: number): Uint8Array {
    let g: Uint8Array = new Uint8Array([1]);
    for (let i = 0; i < nParity; i++) {
      // (x - a^i) = (x + a^i) in GF(2)
      g = this.gfPolyMul(g, new Uint8Array([1, this.expTable[i]]));
    }
    return g;
  }

  /**
   * Encodes data block of length K, producing parity bytes
   */
  public encode(data: Uint8Array): Uint8Array {
    const parity = new Uint8Array(this.parityBytes);
    for (let i = 0; i < data.length; i++) {
      const feedback = data[i] ^ parity[0];
      for (let j = 0; j < this.parityBytes - 1; j++) {
        parity[j] = parity[j + 1] ^ this.gfMul(feedback, this.generator[j + 1]);
      }
      parity[this.parityBytes - 1] = this.gfMul(feedback, this.generator[this.parityBytes]);
    }
    return parity;
  }

  /**
   * Decodes and corrects up to parityBytes/2 errors in msg (data + parity)
   * Modifies msg in-place with corrections.
   * Returns number of corrected bytes, or -1 if uncorrectable.
   */
  public decode(msg: Uint8Array): number {
    const n = msg.length;
    const nsym = this.parityBytes;

    // 1. Calculate syndromes
    const syn = new Uint8Array(nsym);
    let hasError = false;
    for (let i = 0; i < nsym; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum = msg[j] ^ this.gfMul(sum, this.expTable[i]);
      }
      syn[i] = sum;
      if (sum !== 0) hasError = true;
    }

    if (!hasError) {
      return 0; // No errors detected
    }

    // 2. Berlekamp-Massey Algorithm to find error locator polynomial Lambda
    let C = new Uint8Array(nsym + 1);
    let B = new Uint8Array(nsym + 1);
    C[0] = 1;
    B[0] = 1;
    let L = 0;
    let m = 1;
    let b = 1;

    for (let i = 0; i < nsym; i++) {
      let d = syn[i];
      for (let j = 1; j <= L; j++) {
        d ^= this.gfMul(C[j], syn[i - j]);
      }

      if (d === 0) {
        m++;
      } else {
        const T = new Uint8Array(C);
        const factor = this.gfDiv(d, b);
        for (let j = 0; j + m <= nsym; j++) {
          C[j + m] ^= this.gfMul(factor, B[j]);
        }

        if (2 * L <= i) {
          L = i + 1 - L;
          B = T;
          b = d;
          m = 1;
        } else {
          m++;
        }
      }
    }

    if (L * 2 > nsym) {
      return -1; // Too many errors to correct
    }

    // 3. Find roots of locator polynomial using Chien search
    const errPos: number[] = [];
    for (let i = 0; i < n; i++) {
      // Evaluate Lambda at alpha^(-i) = alpha^(255 - i)
      const xInv = this.expTable[(255 - (n - 1 - i)) % 255];
      let val = 0;
      for (let j = 0; j <= L; j++) {
        val ^= this.gfMul(C[j], this.expTable[(this.logTable[xInv] * j) % 255]);
      }
      if (val === 0) {
        errPos.push(i);
      }
    }

    if (errPos.length !== L) {
      return -1; // Root search failed (uncorrectable error)
    }

    // 4. Calculate error values using Forney algorithm
    // Omega(x) = [Syn(x) * Lambda(x)] mod x^nsym
    const omega = new Uint8Array(nsym);
    for (let i = 0; i < nsym; i++) {
      for (let j = 0; j <= Math.min(i, L); j++) {
        omega[i] ^= this.gfMul(syn[i - j], C[j]);
      }
    }

    // For each error position, calculate magnitude
    for (const pos of errPos) {
      const xInv = this.expTable[(255 - (n - 1 - pos)) % 255];
      const x = this.expTable[(n - 1 - pos) % 255];

      // Evaluate Omega(xInv)
      let num = 0;
      for (let j = 0; j < nsym; j++) {
        num ^= this.gfMul(omega[j], this.expTable[(this.logTable[xInv] * j) % 255]);
      }

      // Evaluate Lambda'(xInv) formal derivative (only odd powers survive)
      let den = 0;
      for (let j = 1; j <= L; j += 2) {
        den ^= this.gfMul(C[j], this.expTable[(this.logTable[xInv] * (j - 1)) % 255]);
      }

      if (den === 0) return -1;
      const mag = this.gfMul(x, this.gfDiv(num, den));
      msg[pos] ^= mag;
    }

    return errPos.length;
  }
}
