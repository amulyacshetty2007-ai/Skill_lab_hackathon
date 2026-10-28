import crypto from 'node:crypto';

// Unambiguous alphabet (no 0/O, 1/I) -> 32^10 combinations, drawn from the OS CSPRNG so PNRs can't be guessed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newPnr() {
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}
