# capacitor-phantom-plugin

Phantom wallet deep link adapter for Capacitor apps.
Drop-in replacement for `PhantomWalletAdapter` on Android and iOS.
Works with `@solana/wallet-adapter` — no code changes needed in your components.

Maintained by [DeSocial](mailto:desocialorg@gmail.com)

---

## Install

```bash
npm install capacitor-phantom-plugin
```

Peer dependencies (install if not already in your project):

```bash
npm install @capacitor/core @capacitor/app @capacitor/browser
npm install @solana/wallet-adapter-base @solana/web3.js
```

---

## Usage

```tsx
import { Capacitor } from "@capacitor/core";
import { PhantomDeepLinkAdapter } from "capacitor-phantom-deeplink";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletProvider } from "@solana/wallet-adapter-react";

const wallets = Capacitor.isNativePlatform()
  ? [
      new PhantomDeepLinkAdapter({
        appUrl: "https://myapp.com",   // shown in Phantom's connect screen
        scheme: "myapp",               // your app's custom URL scheme
        cluster: "devnet",             // "mainnet-beta" | "devnet" | "testnet"
      }),
    ]
  : [
      new PhantomWalletAdapter(),      // browser extension on web
    ];

export function App() {
  return (
    <WalletProvider wallets={wallets} autoConnect>
      {/* your app */}
    </WalletProvider>
  );
}
```

Your component code is identical on web and mobile:

```tsx
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

function MyComponent() {
  const { publicKey, connected, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();

  async function sign() {
    const sig = await signMessage!(new TextEncoder().encode("Hello!"));
    console.log(sig);
  }

  return <button onClick={sign}>Sign</button>;
}
```

---

## Android setup

In `android/app/src/main/AndroidManifest.xml`, add inside `<activity>`:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="myapp" android:host="phantom" />
</intent-filter>
```

Replace `myapp` with your scheme.

---

## iOS setup

**1. Register your URL scheme in Xcode**

Xcode → your target → Info tab → URL Types → +:
```
Identifier:  com.yourcompany.yourapp
URL Schemes: myapp
```

**2. Allow querying `phantom://` in `Info.plist`**

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
    <string>phantom</string>
</array>
```

---

## How it works

1. User taps Connect → app opens `phantom://v1/connect?...`
2. Phantom shows approval screen
3. Phantom redirects to `myapp://phantom/connect?nonce=...&data=...`
4. OS routes `myapp://` back to your app
5. Adapter decrypts the response → wallet connected

All communication is end-to-end encrypted using X25519 Diffie-Hellman + XSalsa20-Poly1305 (via `tweetnacl`). Sessions persist across app restarts via `localStorage`.

---

## API

### `new PhantomDeepLinkAdapter(config)`

| Option | Type | Required | Description |
|---|---|---|---|
| `appUrl` | `string` | ✅ | Displayed in Phantom's connect screen. Any valid `https://` URL. |
| `scheme` | `string` | ✅ | Your app's custom URL scheme (e.g. `"myapp"`). Must match your manifest. |
| `cluster` | `string` | ❌ | `"mainnet-beta"` (default) \| `"devnet"` \| `"testnet"` |

Implements the full `@solana/wallet-adapter-base` `SignerWalletAdapter` interface:
- `connect()`
- `disconnect()`
- `signTransaction(tx)`
- `signAllTransactions(txs)`
- `signMessage(message)`

---

## License

MIT
