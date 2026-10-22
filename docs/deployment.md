# Coordinator on server 208

Public endpoint: `wss://freep2pagent.thinkelution.com/ws`.
Health: `https://freep2pagent.thinkelution.com/health`.
Cloudflare DNS: unproxied A record to `208.110.72.147`.
SSH: `administrator@208.110.72.147`.

## Services

| Service | Configuration |
| --- | --- |
| `freep2pagent.service` | Node coordinator on `127.0.0.1:4390` |
| nginx site `freep2pagent` | HTTPS/WSS 443, HTTP 80 for ACME/redirect |
| `freep2pagent-relay.service` | coturn UDP/TCP 3478; UDP relay range 49160–49200 |

Google STUN is used for discovery. TURN issues short-lived HMAC credentials, with four allocations per username, 100 total allocations and bandwidth limits. Private/loopback/link-local/multicast peer destinations are denied. TURN-over-TLS on 443 is not configured; some restrictive networks may fail.

Releases live under `/opt/freep2pagent/releases/`, selected by the `current` symlink. Restricted environment and relay configuration live under `/etc/freep2pagent`. Both services run as the dedicated unprivileged `freep2pagent` user. Do not commit credentials or user profiles.

## Install

`deploy/dns.py` accepts `CLOUDFLARE_API_TOKEN` or an explicitly supplied credential file. It changes only the authorized hostname and refuses conflicting records.

Upload `coordinator/`, `shared/`, and `deploy/install.py` into `/home/administrator/freep2p-release`, then run:

```sh
sudo python3 /home/administrator/freep2p-release/deploy/install.py /home/administrator/freep2p-release
```

The installer creates a release, installs the pinned production ws dependency, sets up systemd and a dedicated nginx vhost, obtains a Let's Encrypt certificate, and configures coturn. Review server-specific paths before reuse. The coordinator supports the host's existing Node runtime, but a maintained Node 24 runtime is recommended for ongoing operation.

Certbot renews the certificate; a deployment hook validates/reloads nginx. Desktop CI has no server credentials and does not deploy the coordinator.

## Operations and rollback

```sh
curl --fail https://freep2pagent.thinkelution.com/health
sudo systemctl status freep2pagent freep2pagent-relay
sudo journalctl -u freep2pagent --since '15 minutes ago'
sudo journalctl -u freep2pagent-relay --since '15 minutes ago'
```

Service health alone does not verify relay connectivity. Test real clients on different networks and a forced-relay connection. Watch relay bandwidth and errors as usage grows. Anonymous identity creation requires stronger abuse controls before broad adoption; this deployment uses connection/message and bandwidth limits.

The previous release is recorded at `/opt/freep2pagent/previous-release`. Inspect that path, repoint `current` to it, and restart only `freep2pagent.service`. Nginx backups live under `/opt/freep2pagent/nginx-*.conf`; restore only this application's vhost, validate `nginx -t`, then reload. Stop the two FreeP2PAgent services to disable this app without affecting other hosted applications.

## Protocol notes

Identity is SHA-256 of an Ed25519 public key. Coordinator authentication signs a fresh challenge. Every contact/signaling envelope has sender, recipient, timestamp, nonce and signature. Signed SDP binds the peer's DTLS fingerprint to its accepted identity. The coordinator accepts only contact control and SDP, never chat or file content.

Presence is accessible to holders of a high-entropy device ID; the preview does not enforce a durable mutual friendship graph on the server. Chat history remains local. Files use 32 KiB chunks and disk-write acknowledgments, favoring bounded memory over maximum high-latency throughput. Received files are finalized only after size and SHA-256 match.
