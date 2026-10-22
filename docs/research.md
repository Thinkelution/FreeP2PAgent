# Similar-project research

Research date: 22 October 2026. Based on official project pages and documentation; no hands-on reliability or security evaluation was performed.

## Finding

The core idea already exists in several forms. FreeP2PAgent's opportunity is a cohesive, approachable product combining persistent friend contacts, native background presence, internet file transfer, and eventually permissioned compute. These are proposed differentiators, not a claim of technical novelty or an exhaustive market search.

| Project | Relevant overlap | Implication for FreeP2PAgent |
| --- | --- | --- |
| [Jami](https://jami.net/) | Open-source P2P messaging, file sharing, multiple devices, Windows/macOS/Android, and extensions. | Closest complete product benchmark. A lightweight central directory alone is not a novel distinction. |
| [Tox](https://tox.chat/) | Encrypted distributed messaging and file transfer; separate desktop and Android clients. | Closely matches the friends-and-direct-communication concept. Its official download page cautions about development status. |
| [RetroShare](https://retroshare.cc/) | Friend-to-friend encrypted network with chat, files, mail, and other distributed services. | Closest conceptual precedent for trusted friends running persistent nodes. |
| [PairDrop](https://github.com/schlagmichdoch/PairDrop) | Browser file/text transfer, persistent pairing, internet connections, and TURN fallback. | Strong reference for a smaller transfer-first MVP. Persistent paired devices are already an existing feature. |
| [LocalSend](https://localsend.org/) | Open-source file transfer across Windows, macOS, Android, and other platforms. | Useful simplicity benchmark; its documented scope is local-network transfer, not internet friend messaging. |
| [iroh](https://docs.iroh.computer/) | Encrypted authenticated QUIC connections, direct when possible and relayed when necessary. | A potential transport building block, not a competing ready-made social app. |

## Practical implications

### P2P does not eliminate infrastructure

Jami's [technical documentation](https://docs.jami.net/en_US/user/lan-only.html) describes bootstrap nodes, TURN fallback, mobile DHT proxies/push, and name-service dependencies. PairDrop's [README](https://github.com/schlagmichdoch/PairDrop#readme) documents TURN use for internet connections behind NAT. Design FreeP2PAgent as direct-first, with a clearly visible encrypted relay fallback. Relay bandwidth can dominate operating cost even when the directory is small.

### Static hosting is only one part

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) hosts static HTML, CSS, and JavaScript. It can publish the website and browser UI, but a persistent signaling service and live directory need a backend. Installer downloads can be published separately as release assets.

### Android needs a separate availability design

[Android's Doze and App Standby documentation](https://developer.android.com/training/monitoring-device-state/doze-standby) explains background networking restrictions. A persistent desktop WebSocket does not establish that Android will receive messages while idle. Prototype notification wake-up, reconnection, and user-visible transfer execution before promising always-on delivery.

### Name discovery is not identity verification

Proposed design: display names may be duplicated; cryptographic identities are stable. Use invite links or QR codes for initial pairing, and expose fingerprint verification. A directory result must not silently replace an already trusted friend's key.

### Inference is an extension, not the first milestone

Proposed design: start with local summarization or file classification. Later allow a friend to request a narrowly defined inference job with explicit permission, resource limits, cancellation, and an audit trail. The friend executing a job can see its plaintext input; encrypted transport does not provide confidential computation.

## What can be reused from ItsMyServer

Local inspection found an Electron README describing tray operation, launch-at-login, node registration, shared folders, and WebSocket signaling. Package scripts currently target macOS DMG/ZIP. The renderer and signaling sources reference WebRTC and data channels. This is evidence of an existing conceptual/code starting point, not proof of a complete tested transfer implementation.

Reuse candidates after code review: desktop lifecycle, signaling message patterns, file streaming, and packaging experience. New work: identity and device keys, mutual contacts, private discovery, chat persistence, authenticated session binding, Windows packaging, Android, and relay operations.

## Recommended next experiment

Build a two-device desktop prototype: QR pairing, verified identity, one chat, one streamed file, and connection status. Test LAN, different residential networks, mobile hotspot, blocked UDP, peer sleep, reconnect, and interrupted transfer. Then test Android screen-off delivery. Choose the long-term transport and UI stack from those results.

Additional primary source: [Tox client downloads and project caveats](https://tox.chat/download.html).
