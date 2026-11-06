import { hash, verify } from "@node-rs/argon2";

// NFR-01: Argon2id with the OWASP minimum parameters (19 MiB, 2 iterations,
// 1 thread). Argon2id is the library default; the tests check the hash prefix.
// The library's Algorithm enum is not passed because it does not exist at
// runtime (it is a const enum). 19 MiB per hash suits a server with 1 GB.
const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

// NFR-02: from 15 to 64 characters, without composition rules.
const MIN_LENGTH = 15;
const MAX_LENGTH = 64;

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

// Counts characters (Unicode code points), not bytes or UTF-16 units.
export function isAcceptableLength(password: string): boolean {
  const length = [...password].length;
  return length >= MIN_LENGTH && length <= MAX_LENGTH;
}
