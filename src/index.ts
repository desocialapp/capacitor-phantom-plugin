export { PhantomDeepLinkAdapter, PhantomDeepLinkWalletName, getClusterParam } from "./PhantomDeepLinkAdapter";
export type { PhantomDeepLinkAdapterConfig } from "./PhantomDeepLinkAdapter";

// Internal helpers — exported for advanced use cases
export {
  buildConnectUrl,
  buildDisconnectUrl,
  buildSignMessageUrl,
  buildSignTransactionUrl,
  parseCallbackUrl,
  processConnectCallback,
  processSignMessageCallback,
  processSignTransactionCallback,
  getPhantomBaseUrl,
  PHANTOM_APP_URL,
  PHANTOM_WEB_URL,
} from "./phantom";

export type {
  ConnectCallbackParams,
  SignTransactionCallbackParams,
  SignMessageCallbackParams,
} from "./phantom";

export { saveSession, loadSession, clearSession } from "./storage";
