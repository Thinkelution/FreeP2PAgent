# FreeP2PAgent

An open-source personal peer agent for friends, direct chat, file transfers, and eventually permissioned inference.

**Status: research and architecture proposal. No working client, installers, or deployed coordinator yet.**

## Concept

Install a Windows tray app, macOS menu-bar app, or Android app. Create a local identity, choose a display name, invite friends, and exchange messages and files over authenticated encrypted connections. An optional directory helps friends find each other. Location sharing is optional and separate from identity.

The project takes ItsMyServer's tray, node-registration, and signaling concepts as a starting point. This repository currently contains original planning documents; it does not copy the existing application's source or deployment configuration.

## Proposed hosting

- GitHub Pages: static website, documentation, and download links.
- GitHub Releases: Windows installer, Android APK, and macOS DMG when available.
- Maintainer server: directory, rendezvous/signaling, and optional announcement feed.
- Optional authenticated relay: encrypted traffic fallback where direct connections fail.
- User devices: identity keys, contact list, message history, files, and future local inference.

The maintainer's existing server, referred to as server 208 during planning, is a proposed deployment target only. Its configuration and capacity have not been assessed.

## Research and plan

- [Similar projects and findings](docs/research.md)
- [Architecture and initial scope](docs/architecture.md)

Initial targets: Windows and macOS desktop proof of concept, followed by an Android connectivity/background-delivery prototype. Do not assume a desktop background process can be ported unchanged to Android.

## License

MIT for original material in this repository. Any reused dependencies or source retain their own licenses and require separate compatibility review.
