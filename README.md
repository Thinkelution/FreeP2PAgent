# FreeP2PAgent

An open-source personal peer agent for friends, direct chat, file transfers, and eventually permissioned inference.

**Version 0.1.0: desktop MVP for Windows, macOS, and Linux. Android and inference are future work.**

[Website & downloads](https://thinkelution.github.io/FreeP2PAgent/) · [Release notes](docs/releases/v0.1.0.md) · [GitHub releases](https://github.com/Thinkelution/FreeP2PAgent/releases)

## Concept

Install a Windows tray app, macOS menu-bar app, or Android app. Create a local identity, choose a display name, invite friends, and exchange messages and files over authenticated encrypted connections. An optional directory helps friends find each other. Location sharing is optional and separate from identity.

The project takes ItsMyServer's tray, node-registration, and signaling concepts as a starting point. See [NOTICE](NOTICE) for provenance. It adds signed identities, mutual friends, direct WebRTC chat and file transfers, local history, delivery receipts, accept/save dialogs, progress, cancellation, and SHA-256 verification. Closing the window keeps the agent in the tray; use the tray's Quit command to exit.

## Try the desktop MVP

Use Node 24 LTS (minimum 22.12):

```sh
npm ci
npm start
```

Choose a display name in Settings. Share **Copy my invite** through a trusted channel. Your friend uses **Add a friend**; accept their incoming request to connect. Both devices must be online. Compare full identity fingerprints by hovering the identity label. Once connected, chat or use the **+** button to offer a file. The recipient must accept and choose a save location.

The default coordinator is `wss://freep2pagent.thinkelution.com/ws`. For development, run `npm run coordinator` and use `ws://127.0.0.1:4390/ws` in Settings. Public coordinator URLs require WSS.

## GitHub builds

[Desktop CI](https://github.com/Thinkelution/FreeP2PAgent/actions/workflows/desktop.yml) runs syntax checks, security/file tests, and a real two-instance Electron integration test before packaging:

| Platform | Packages |
| --- | --- |
| Windows x64 | NSIS installer, ZIP |
| macOS Apple Silicon and Intel | DMG, ZIP for each architecture |
| Linux x64 | AppImage, DEB |

Download artifacts from a successful Actions run. Preview builds are unsigned; macOS builds are not notarized. Linux needs an unlocked Secret Service keyring (GNOME Keyring or KWallet); tray visibility depends on the desktop environment. Build status in Actions is authoritative.

Windows/Linux E2E uses local direct peers. Hosted macOS runners use the real external relay because direct loopback tests time out in those VMs; that test requires the deployed coordinator/relay to be reachable. On macOS, allow Local Network access when the OS prompts to enable LAN connections. Direct LAN behavior on physical Macs still needs validation.

```sh
npm run check
npm test
npm run test:e2e
npm run build -- --win --x64
# On the respective native host:
npm run build -- --mac --arm64
npm run build -- --linux --x64
```

## MVP boundaries

Identity keys use OS-protected storage. Contacts and the last 500 messages per friend are local JSON, **not encrypted at rest**. The coordinator sees names, IDs, presence, IP addresses and signaling metadata; it stores no chat/file mailbox. Direct peers see each other's network addresses. This is an early, unaudited messenger, not an anonymity tool.

Chat sends only while connected. Unacknowledged messages remain Unconfirmed; no offline message queue or automatic resend is implemented. File transfers support up to 10 GB, bounded chunk streaming and checksum verification. Interrupted transfers must be sent again. Orderly cancellation removes partial files; a crash may leave a `.freep2p-part` file next to the destination for manual cleanup.

Each installation has its own identity. Do not copy profiles between OS accounts or computers. No identity recovery, account linking, location collection, automatic updates, launch-at-login, group chat or AI execution is included yet.

## Hosting

- GitHub Pages: static website, documentation, and download links.
- GitHub Releases: Windows installer, Android APK, and macOS DMG when available.
- Maintainer server: directory, rendezvous/signaling, and optional announcement feed.
- Optional authenticated relay: encrypted traffic fallback where direct connections fail.
- User devices: identity keys, contact list, message history, files, and future local inference.

Server 208 runs dedicated coordinator and authenticated coturn services. Google STUN handles discovery; TURN on 208 is the fallback. [Deployment and operations](docs/deployment.md) describes ports, limits and rollback. Static GitHub Pages publishing is not part of this desktop milestone.

## Research and plan

- [Similar projects and findings](docs/research.md)
- [Architecture and initial scope](docs/architecture.md)

The architecture document is the original proposal, not a statement that future features are implemented. Android's background behavior will be designed separately.

## License

MIT for original material in this repository. Any reused dependencies or source retain their own licenses and require separate compatibility review.
