import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  private readonly saltRounds: number;

  constructor(saltRounds = 12) {
    this.saltRounds = saltRounds;
  }

  public async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  public async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

/**
 * Built-in Node crypto Scrypt hasher fallback (zero external dependencies).
 */
export class ScryptPasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  public async verify(password: string, hash: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return false;
    }
    const [, salt, expectedHashHex] = parts;
    if (!salt || !expectedHashHex) return false;

    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const keyBuf = derivedKey;
    const expectedBuf = Buffer.from(expectedHashHex, 'hex');
    if (keyBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, expectedBuf);
  }
}

export const defaultPasswordHasher = new BcryptPasswordHasher();
