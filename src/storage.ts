import bs58 from "bs58";
import nacl from "tweetnacl";
import { deserializeKeyPair, serializeKeyPair } from "./phantom";

const STORAGE_KEY = "phantom_deeplink_session_v1";

interface PersistedSession {
  dappPublicKey: string;
  dappSecretKey: string;
  sharedSecret: string | null;
  phantomPublicKey: string | null;
  walletPublicKey: string | null;
  session: string | null;
}

export function saveSession(
  dappKeyPair: nacl.BoxKeyPair,
  sharedSecret: Uint8Array | null,
  phantomPublicKey: string | null,
  walletPublicKey: string | null,
  session: string | null
): void {
  if (typeof window === "undefined") return;
  const kp = serializeKeyPair(dappKeyPair);
  const data: PersistedSession = {
    dappPublicKey: kp.publicKey,
    dappSecretKey: kp.secretKey,
    sharedSecret: sharedSecret ? bs58.encode(sharedSecret) : null,
    phantomPublicKey,
    walletPublicKey,
    session,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadSession(): {
  dappKeyPair: nacl.BoxKeyPair;
  sharedSecret: Uint8Array | null;
  phantomPublicKey: string | null;
  walletPublicKey: string | null;
  session: string | null;
} | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data: PersistedSession = JSON.parse(raw);
    return {
      dappKeyPair: deserializeKeyPair({
        publicKey: data.dappPublicKey,
        secretKey: data.dappSecretKey,
      }),
      sharedSecret: data.sharedSecret ? bs58.decode(data.sharedSecret) : null,
      phantomPublicKey: data.phantomPublicKey,
      walletPublicKey: data.walletPublicKey,
      session: data.session,
    };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
