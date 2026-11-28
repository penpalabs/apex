// The one-time pad — the only cipher with PROVEN perfect secrecy, and the cautionary
// tale baked into its name. XOR the message with a truly random key as long as the
// message; the ciphertext is then statistically independent of the plaintext, so it
// leaks nothing — for ANY ciphertext and ANY target message there exists a key that
// connects them, so the attacker can rule nothing out. The catch: the key must be
// random, secret, and used exactly ONCE. Reuse it and C1⊕C2 = P1⊕P2 — the same
// nonce-reuse trap as CTR/GCM and ECDSA. Pure XOR; tested.

import { xorBytes } from './bytes';

/** Encrypt == decrypt: ciphertext = plaintext ⊕ key. The OTP requires a key AT LEAST as long as the
 *  message; xorBytes covers only the overlap, so a shorter key encrypts just a prefix (never do that). */
export const otpEncrypt = (plaintext: Uint8Array, key: Uint8Array): Uint8Array => xorBytes(plaintext, key);

/** Perfect secrecy made concrete: the key that decrypts THIS ciphertext to ANY chosen
 *  message. Its existence is why a one-time-pad ciphertext reveals nothing. */
export const keyFor = (ciphertext: Uint8Array, target: Uint8Array): Uint8Array => xorBytes(ciphertext, target);
