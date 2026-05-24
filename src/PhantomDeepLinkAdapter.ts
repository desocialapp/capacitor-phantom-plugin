import {
  BaseSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletName,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
} from "@solana/wallet-adapter-base";
import {
  PublicKey,
  Transaction,
  TransactionVersion,
  VersionedTransaction,
} from "@solana/web3.js";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import nacl from "tweetnacl";
import bs58 from "bs58";

import {
  buildConnectUrl,
  buildDisconnectUrl,
  buildSignMessageUrl,
  buildSignTransactionUrl,
  generateDappKeyPair,
  parseCallbackUrl,
  processConnectCallback,
  processSignMessageCallback,
  processSignTransactionCallback,
} from "./phantom";
import { clearSession, loadSession, saveSession } from "./storage";

export interface PhantomDeepLinkAdapterConfig {
  /** Displayed in Phantom's connect approval screen. Any valid https URL. */
  appUrl: string;
  /** Your app's custom URL scheme (e.g. "myapp"). Must match your AndroidManifest / Info.plist. */
  scheme: string;
  /** Solana cluster to connect to. Defaults to "mainnet-beta". */
  cluster?: "mainnet-beta" | "devnet" | "testnet";
}

export const PhantomDeepLinkWalletName = "Phantom" as WalletName<"Phantom">;

/** Timeout (ms) before a pending sign/connect operation is auto-rejected. */
const PENDING_TIMEOUT_MS = 120_000;

/**
 * Returns the Solana Explorer cluster query param for a given cluster.
 * Mainnet-beta returns an empty string (no param needed).
 * Devnet returns "?cluster=devnet", testnet returns "?cluster=testnet".
 */
export function getClusterParam(cluster: "mainnet-beta" | "devnet" | "testnet"): string {
  if (cluster === "devnet") return "?cluster=devnet";
  if (cluster === "testnet") return "?cluster=testnet";
  return "";
}

/**
 * A Solana wallet adapter that connects to the Phantom mobile app
 * via deep links. Works on Android and iOS inside a Capacitor app.
 * Falls back to unsupported on web (use PhantomWalletAdapter there instead).
 *
 * @example
 * ```ts
 * import { PhantomDeepLinkAdapter } from "capacitor-phantom-deeplink";
 *
 * const wallets = [
 *   new PhantomDeepLinkAdapter({
 *     appUrl: "https://myapp.com",
 *     scheme: "myapp",
 *     cluster: "mainnet-beta",
 *   }),
 * ];
 * ```
 */
export class PhantomDeepLinkAdapter extends BaseSignerWalletAdapter {
  name = PhantomDeepLinkWalletName;
  url = "https://phantom.com";
  icon =
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZyI+PGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNjQiIGZpbGw9IiNBQjlGRjIiLz48cGF0aCBkPSJNMTA4LjUgNjMuNUM5OC41IDM4LjUgNzkuNSAyNiA2NCAyNkM0OC41IDI2IDI5LjUgMzguNSAxOS41IDYzLjVDMjkuNSA4OC41IDQ4LjUgMTAxIDY0IDEwMUM3OS41IDEwMSA5OC41IDg4LjUgMTA4LjUgNjMuNVoiIGZpbGw9IndoaXRlIi8+PGNpcmNsZSBjeD0iNTAiIGN5PSI2MCIgcj0iOCIgZmlsbD0iI0FCOUZGMiIvPjxjaXJjbGUgY3g9Ijc4IiBjeT0iNjAiIHI9IjgiIGZpbGw9IiNBQjlGRjIiLz48L3N2Zz4=";
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(["legacy", 0]);

  private _appUrl: string;
  private _scheme: string;
  private _cluster: "mainnet-beta" | "devnet" | "testnet";

  private _dappKeyPair: nacl.BoxKeyPair | null = null;
  private _sharedSecret: Uint8Array | null = null;
  private _session: string | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  private _pendingConnectResolve: (() => void) | null = null;
  private _pendingConnectReject: ((e: unknown) => void) | null = null;
  private _pendingConnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private _pendingResolve: ((v: string) => void) | null = null;
  private _pendingReject: ((e: unknown) => void) | null = null;
  private _pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  private _listenerHandle: { remove: () => void } | null = null;

  constructor(config: PhantomDeepLinkAdapterConfig) {
    super();
    this._appUrl = config.appUrl;
    this._scheme = config.scheme;
    this._cluster = config.cluster ?? "mainnet-beta";
    this._restoreSession();
    this._registerDeepLinkListener();
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get readyState(): WalletReadyState {
    return Capacitor.isNativePlatform()
      ? WalletReadyState.Loadable
      : WalletReadyState.Unsupported;
  }

  /** The cluster this adapter was configured for. */
  get cluster(): "mainnet-beta" | "devnet" | "testnet" {
    return this._cluster;
  }

  /**
   * Returns the Solana Explorer cluster query param for this adapter's cluster.
   * Useful for building explorer links that match the actual network.
   */
  get clusterParam(): string {
    return getClusterParam(this._cluster);
  }

  private get _connectRedirect() { return `${this._scheme}://phantom/connect`; }
  private get _disconnectRedirect() { return `${this._scheme}://phantom/disconnect`; }
  private get _signTxRedirect() { return `${this._scheme}://phantom/signTransaction`; }
  private get _signMsgRedirect() { return `${this._scheme}://phantom/signMessage`; }

  private _openUrl(url: string): void {
    if (Capacitor.isNativePlatform()) {
      // window.open(_system) tells Capacitor to open outside the WebView,
      // triggering the OS intent handler — works on both Android and iOS.
      window.open(url, "_system");
    } else {
      Browser.open({ url, presentationStyle: "popover" });
    }
  }

  private _restoreSession() {
    const stored = loadSession();
    if (stored?.walletPublicKey && stored.session && stored.sharedSecret) {
      this._dappKeyPair = stored.dappKeyPair;
      this._sharedSecret = stored.sharedSecret;
      this._session = stored.session;
      try {
        this._publicKey = new PublicKey(stored.walletPublicKey);
      } catch {
        this._clearState();
      }
    }
  }

  /**
   * Registers the appUrlOpen deep link listener.
   * Removes any previously registered handle first to prevent listener pile-up
   * on re-renders or multiple constructor calls.
   */
  private _registerDeepLinkListener() {
    if (!Capacitor.isNativePlatform()) return;

    // Remove the old listener before registering a new one so we never
    // accumulate stale handlers across re-renders or hot reloads.
    if (this._listenerHandle) {
      this._listenerHandle.remove();
      this._listenerHandle = null;
    }

    App.addListener("appUrlOpen", ({ url }) => {
      this._handleDeepLink(url);
    }).then((handle) => {
      this._listenerHandle = handle;
    });
  }

  private _handleDeepLink(url: string) {
    try {
      const params = parseCallbackUrl(url);

      if (url.includes("/phantom/connect")) {
        this._handleConnectCallback(params);
        Browser.close().catch(() => {});
        return;
      }
      if (url.includes("/phantom/disconnect")) {
        this._clearState();
        this.emit("disconnect");
        Browser.close().catch(() => {});
        return;
      }
      if (url.includes("/phantom/signTransaction")) {
        if (params.errorCode) { this._rejectPending(params.errorMessage ?? params.errorCode); return; }
        if (!this._sharedSecret) { this._rejectPending("No shared secret"); return; }
        const signedTxBase58 = processSignTransactionCallback(
          params as unknown as Parameters<typeof processSignTransactionCallback>[0],
          this._sharedSecret
        );
        this._resolvePending(signedTxBase58);
        Browser.close().catch(() => {});
        return;
      }
      if (url.includes("/phantom/signMessage")) {
        if (params.errorCode) { this._rejectPending(params.errorMessage ?? params.errorCode); return; }
        if (!this._sharedSecret) { this._rejectPending("No shared secret"); return; }
        const sigBase58 = processSignMessageCallback(
          params as unknown as Parameters<typeof processSignMessageCallback>[0],
          this._sharedSecret
        );
        this._resolvePending(sigBase58);
        Browser.close().catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._rejectPendingConnect(new WalletConnectionError(msg));
      this._rejectPending(msg);
      this.emit("error", new WalletConnectionError(msg));
    }
  }

  private _handleConnectCallback(params: Record<string, string>) {
    if (!this._dappKeyPair) {
      const error = new WalletConnectionError("No dapp keypair for callback");
      this._connecting = false;
      this._rejectPendingConnect(error);
      this.emit("error", error);
      return;
    }
    if (params.errorCode) {
      const error = new WalletConnectionError(params.errorMessage ?? params.errorCode);
      this._connecting = false;
      this._rejectPendingConnect(error);
      this.emit("error", error);
      return;
    }
    const result = processConnectCallback(
      params as unknown as Parameters<typeof processConnectCallback>[0],
      this._dappKeyPair.secretKey
    );
    this._sharedSecret = result.sharedSecret;
    this._session = result.session;
    this._publicKey = new PublicKey(result.walletPublicKey);
    this._connecting = false;
    saveSession(
      this._dappKeyPair,
      result.sharedSecret,
      params.phantom_encryption_public_key,
      result.walletPublicKey,
      result.session
    );
    this.emit("connect", this._publicKey);
    this._resolvePendingConnect();
  }

  private _resolvePendingConnect() {
    if (this._pendingConnectTimeout !== null) {
      clearTimeout(this._pendingConnectTimeout);
      this._pendingConnectTimeout = null;
    }
    this._pendingConnectResolve?.();
    this._pendingConnectResolve = null;
    this._pendingConnectReject = null;
  }

  private _rejectPendingConnect(error: unknown) {
    if (this._pendingConnectTimeout !== null) {
      clearTimeout(this._pendingConnectTimeout);
      this._pendingConnectTimeout = null;
    }
    this._pendingConnectReject?.(error);
    this._pendingConnectResolve = null;
    this._pendingConnectReject = null;
  }

  private _resolvePending(value: string) {
    if (this._pendingTimeout !== null) {
      clearTimeout(this._pendingTimeout);
      this._pendingTimeout = null;
    }
    this._pendingResolve?.(value);
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  private _rejectPending(reason: string) {
    if (this._pendingTimeout !== null) {
      clearTimeout(this._pendingTimeout);
      this._pendingTimeout = null;
    }
    this._pendingReject?.(new Error(reason));
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  private _clearState() {
    this._dappKeyPair = null;
    this._sharedSecret = null;
    this._session = null;
    this._publicKey = null;
    clearSession();
  }

  async connect(): Promise<void> {
    if (this.readyState !== WalletReadyState.Loadable) throw new WalletNotReadyError();
    if (this._publicKey) return;
    if (this._connecting) return;

    return new Promise<void>((resolve, reject) => {
      this._pendingConnectResolve = resolve;
      this._pendingConnectReject = reject;

      // Reject automatically if Phantom never returns (user dismissed / killed app).
      this._pendingConnectTimeout = setTimeout(() => {
        this._pendingConnectTimeout = null;
        this._connecting = false;
        this._rejectPendingConnect(
          new WalletConnectionError("Phantom connect timed out after 120 s — did you return to the app?")
        );
      }, PENDING_TIMEOUT_MS);

      try {
        this._connecting = true;
        const kp = generateDappKeyPair();
        this._dappKeyPair = kp;
        saveSession(kp, null, null, null, null);
        const url = buildConnectUrl(kp, this._appUrl, this._connectRedirect, this._cluster, Capacitor.isNativePlatform());
        this._openUrl(url);
      } catch (err) {
        this._connecting = false;
        this._rejectPendingConnect(
          new WalletConnectionError(err instanceof Error ? err.message : String(err))
        );
      }
    });
  }

  async disconnect(): Promise<void> {
    try {
      if (this._dappKeyPair && this._sharedSecret && this._session) {
        const url = buildDisconnectUrl(this._session, this._dappKeyPair, this._sharedSecret, this._disconnectRedirect, Capacitor.isNativePlatform());
        this._clearState();
        this.emit("disconnect");
        this._openUrl(url);
      } else {
        this._clearState();
        this.emit("disconnect");
      }
    } catch (err) {
      throw new WalletDisconnectionError(err instanceof Error ? err.message : String(err));
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this._publicKey || !this._sharedSecret || !this._session || !this._dappKeyPair) {
      throw new WalletNotConnectedError();
    }
    const session = this._session;
    const dappKeyPair = this._dappKeyPair;
    const sharedSecret = this._sharedSecret;

    return new Promise<T>((resolve, reject) => {
      this._pendingResolve = (signedTxBase58: string) => {
        try {
          const bytes = bs58.decode(signedTxBase58);
          const signed = tx instanceof VersionedTransaction
            ? VersionedTransaction.deserialize(bytes)
            : Transaction.from(bytes);
          resolve(signed as T);
        } catch (e) {
          reject(new WalletSignTransactionError(String(e)));
        }
      };
      this._pendingReject = (e) => reject(new WalletSignTransactionError(String(e)));

      // Reject automatically if Phantom never returns.
      this._pendingTimeout = setTimeout(() => {
        this._pendingTimeout = null;
        this._rejectPending("Phantom signTransaction timed out after 120 s — did you return to the app?");
      }, PENDING_TIMEOUT_MS);

      const serialized = tx instanceof VersionedTransaction
        ? bs58.encode(tx.serialize())
        : bs58.encode(tx.serialize({ requireAllSignatures: false }));

      const url = buildSignTransactionUrl(serialized, session, dappKeyPair, sharedSecret, this._signTxRedirect, Capacitor.isNativePlatform());
      this._openUrl(url);
    });
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    const results: T[] = [];
    for (const tx of txs) results.push(await this.signTransaction(tx));
    return results;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._publicKey || !this._sharedSecret || !this._session || !this._dappKeyPair) {
      throw new WalletNotConnectedError();
    }
    const session = this._session;
    const dappKeyPair = this._dappKeyPair;
    const sharedSecret = this._sharedSecret;

    return new Promise<Uint8Array>((resolve, reject) => {
      this._pendingResolve = (sigBase58: string) => resolve(bs58.decode(sigBase58));
      this._pendingReject = (e) => reject(new WalletSignMessageError(String(e)));

      // Reject automatically if Phantom never returns.
      this._pendingTimeout = setTimeout(() => {
        this._pendingTimeout = null;
        this._rejectPending("Phantom signMessage timed out after 120 s — did you return to the app?");
      }, PENDING_TIMEOUT_MS);

      const url = buildSignMessageUrl(message, session, dappKeyPair, sharedSecret, this._signMsgRedirect, Capacitor.isNativePlatform());
      this._openUrl(url);
    });
  }

  destroy() {
    // Clear any pending timeouts so they don't fire after the adapter is gone.
    if (this._pendingConnectTimeout !== null) {
      clearTimeout(this._pendingConnectTimeout);
      this._pendingConnectTimeout = null;
    }
    if (this._pendingTimeout !== null) {
      clearTimeout(this._pendingTimeout);
      this._pendingTimeout = null;
    }
    this._listenerHandle?.remove();
    this._listenerHandle = null;
  }
}
