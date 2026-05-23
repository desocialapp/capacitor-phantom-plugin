import nacl from "tweetnacl";
import bs58 from "bs58";

export interface ConnectCallbackParams {
  phantom_encryption_public_key: string;
  nonce: string;
  data: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SignTransactionCallbackParams {
  nonce: string;
  data: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SignMessageCallbackParams {
  nonce: string;
  data: string;
  errorCode?: string;
  errorMessage?: string;
}

export const PHANTOM_WEB_URL = "https://phantom.app/ul/v1";
export const PHANTOM_APP_URL = "phantom://v1";

export function getPhantomBaseUrl(useAppScheme = true): string {
  return useAppScheme ? PHANTOM_APP_URL : PHANTOM_WEB_URL;
}

export function generateDappKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

export function serializeKeyPair(kp: nacl.BoxKeyPair) {
  return {
    publicKey: bs58.encode(kp.publicKey),
    secretKey: bs58.encode(kp.secretKey),
  };
}

export function deserializeKeyPair(obj: {
  publicKey: string;
  secretKey: string;
}): nacl.BoxKeyPair {
  return {
    publicKey: bs58.decode(obj.publicKey),
    secretKey: bs58.decode(obj.secretKey),
  };
}

export function buildSharedSecret(
  phantomPublicKeyBase58: string,
  dappSecretKey: Uint8Array
): Uint8Array {
  const phantomPublicKey = bs58.decode(phantomPublicKeyBase58);
  return nacl.box.before(phantomPublicKey, dappSecretKey);
}

export function encryptPayload(
  payload: Record<string, unknown>,
  sharedSecret: Uint8Array
): [string, string] {
  const nonce = nacl.randomBytes(24);
  const messageUint8 = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = nacl.box.after(messageUint8, nonce, sharedSecret);
  return [bs58.encode(nonce), bs58.encode(encrypted)];
}

export function decryptPayload(
  dataBase58: string,
  nonceBase58: string,
  sharedSecret: Uint8Array
): Record<string, unknown> {
  const data = bs58.decode(dataBase58);
  const nonce = bs58.decode(nonceBase58);
  const decrypted = nacl.box.open.after(data, nonce, sharedSecret);
  if (!decrypted) throw new Error("Failed to decrypt Phantom response");
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function buildConnectUrl(
  dappKeyPair: nacl.BoxKeyPair,
  appUrl: string,
  redirectLink: string,
  cluster: "mainnet-beta" | "devnet" | "testnet" = "mainnet-beta",
  useAppScheme = true
): string {
  const params = new URLSearchParams({
    app_url: appUrl,
    dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
    redirect_link: redirectLink,
    cluster,
  });
  return `${getPhantomBaseUrl(useAppScheme)}/connect?${params.toString()}`;
}

export function buildSignTransactionUrl(
  serializedTxBase58: string,
  session: string,
  dappKeyPair: nacl.BoxKeyPair,
  sharedSecret: Uint8Array,
  redirectLink: string,
  useAppScheme = true
): string {
  const payload = { transaction: serializedTxBase58, session };
  const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
    nonce,
    redirect_link: redirectLink,
    payload: encryptedPayload,
  });
  return `${getPhantomBaseUrl(useAppScheme)}/signTransaction?${params.toString()}`;
}

export function buildSignMessageUrl(
  message: Uint8Array,
  session: string,
  dappKeyPair: nacl.BoxKeyPair,
  sharedSecret: Uint8Array,
  redirectLink: string,
  useAppScheme = true
): string {
  const payload = { message: bs58.encode(message), session };
  const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
    nonce,
    redirect_link: redirectLink,
    payload: encryptedPayload,
  });
  return `${getPhantomBaseUrl(useAppScheme)}/signMessage?${params.toString()}`;
}

export function buildDisconnectUrl(
  session: string,
  dappKeyPair: nacl.BoxKeyPair,
  sharedSecret: Uint8Array,
  redirectLink: string,
  useAppScheme = true
): string {
  const payload = { session };
  const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
    nonce,
    redirect_link: redirectLink,
    payload: encryptedPayload,
  });
  return `${getPhantomBaseUrl(useAppScheme)}/disconnect?${params.toString()}`;
}

export function parseCallbackUrl(url: string): Record<string, string> {
  try {
    const parsed = new URL(
      url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "https://placeholder/")
    );
    const result: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  } catch {
    const qs = url.includes("?") ? url.split("?")[1] : "";
    return Object.fromEntries(new URLSearchParams(qs));
  }
}

export function processConnectCallback(
  params: ConnectCallbackParams,
  dappSecretKey: Uint8Array
): { walletPublicKey: string; session: string; sharedSecret: Uint8Array } {
  if (params.errorCode) {
    throw new Error(`Phantom connect error [${params.errorCode}]: ${params.errorMessage}`);
  }
  const sharedSecret = buildSharedSecret(params.phantom_encryption_public_key, dappSecretKey);
  const decrypted = decryptPayload(params.data, params.nonce, sharedSecret);
  return {
    walletPublicKey: decrypted.public_key as string,
    session: decrypted.session as string,
    sharedSecret,
  };
}

export function processSignTransactionCallback(
  params: SignTransactionCallbackParams,
  sharedSecret: Uint8Array
): string {
  if (params.errorCode) {
    throw new Error(`Phantom signTransaction error [${params.errorCode}]: ${params.errorMessage}`);
  }
  const decrypted = decryptPayload(params.data, params.nonce, sharedSecret);
  return decrypted.transaction as string;
}

export function processSignMessageCallback(
  params: SignMessageCallbackParams,
  sharedSecret: Uint8Array
): string {
  if (params.errorCode) {
    throw new Error(`Phantom signMessage error [${params.errorCode}]: ${params.errorMessage}`);
  }
  const decrypted = decryptPayload(params.data, params.nonce, sharedSecret);
  return decrypted.signature as string;
}
