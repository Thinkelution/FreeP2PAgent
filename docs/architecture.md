# Proposed architecture

This is a design proposal, not an implemented service.

## Components

```text
GitHub Pages                 GitHub Releases
website / docs               signed installers
       |                            |
       +--------- user ------------+
                    |
       Agent A <==== encrypted ====> Agent B
          |          direct            |
          +---- directory/signaler ----+
          +---- encrypted relay ------+  fallback
```

The coordinator assists discovery and connection establishment. Direct traffic bypasses it. When a relay is needed, traffic passes through infrastructure while remaining encrypted between authenticated peers. A centralized directory makes the overall system centrally coordinated, even with P2P payload transport.

## Identity and contacts

- Generate and protect identity/device keys locally using appropriate OS storage.
- Separate display name, optional unique directory handle, account identity, and device identity.
- Invite by link or QR; require mutual contact acceptance. Support revoke, block, and device removal.
- Authenticate the connection against the paired identity; transport encryption alone is not sufficient protection against a malicious signaling service.
- Keep the authoritative friend list locally. Directory discoverability is opt-in and rate-limited.
- Model installations as user-linked devices rather than listing every installation publicly.
- Define key backup, recovery, device linking, and key-change verification before broad release.

## Data placement

| Data | Proposed location |
| --- | --- |
| Private keys | Device secure storage |
| Contact list and history | Local encrypted storage |
| Display name / optional handle / public identity | Minimal coordinator index, subject to visibility choices |
| Presence | Expiring coordinator entries, visible to authorized contacts |
| Files | Sender/recipient devices; streamed through relay only when necessary |
| Location | Device only by default; explicitly shared to selected contacts with expiry |
| Announcements | Opt-in signed maintainer feed |

The coordinator can observe connection metadata such as IP addresses and timing. Direct peers also learn network addresses. Do not market this as anonymity. OS location permission does not grant permission to publish location to the directory; obtain separate audience and duration choices.

Interpret “repository of friends” as an application directory, not a public Git repository containing users' contacts, locations, or presence history.

## Offline behavior

MVP: queue outgoing messages locally and deliver when both peers reconnect. Show pending status honestly. A suspended or offline phone cannot reliably receive a direct transfer. Later consider an opt-in encrypted mailbox with expiry, quotas, and deletion semantics. That would add server storage and must be documented separately.

## Transport and clients

Initial experiment: retain the ItsMyServer Electron/WebRTC approach for desktop because it minimizes the distance from the existing concept. Review dependencies and IPC/security boundaries before reuse. Electron does not produce an Android APK; Android needs its own client integration.

Alternative to evaluate: a shared native core using iroh, with platform-specific UI/lifecycle integration. Compare implementation effort, resumable large-file transfer, native mobile support, browser interoperability, and relay operations before committing to a rewrite.

Windows tray and macOS menu-bar clients should expose presence, friends, transfers, pause, settings, and exit. Android should use platform-appropriate notifications and transfer controls, with background behavior tested on real devices.

## Coordinator and relay

Proposed deployment on the maintainer's existing server:

- TLS API and WebSocket signaling with authentication, short-lived session state, and rate limits.
- Minimal directory storage and per-contact visibility enforcement.
- Short-lived TURN credentials if WebRTC is selected; quotas and bandwidth monitoring.
- Signed optional announcements, separate from software updates and permission grants.
- Configurable coordinator URL so self-hosting is possible; migration semantics remain to be designed.

No deployment has been made. Do not assume the existing server's capacity or firewall configuration is suitable until measured.

## Milestones

1. Validate the transport with two desktop peers and forced relay conditions.
2. Add identities, mutual friends, one-to-one chat, and accepted file transfers with progress, integrity verification, and bounded memory use.
3. Test Android availability under idle, sleep, reconnect, and battery restrictions.
4. Add Windows installer, macOS DMG, Android APK, release checksums, signing, and platform release validation.
5. Publish static documentation/download links on GitHub Pages and deploy a documented self-hostable coordinator.
6. Add optional per-contact location sharing and maintainer notifications.
7. Add local inference; then explicitly permissioned remote inference with resource quotas. Do not expose arbitrary remote shell execution through chat.

First-release non-goals: public geographic search, distributed model training, group calls, arbitrary plugins, and guaranteed offline delivery.
