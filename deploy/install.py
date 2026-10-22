#!/usr/bin/env python3
"""Install an uploaded coordinator release on the authorized server 208.

Run as root: python3 install.py /home/administrator/freep2p-release
Does not print secrets; keeps previous nginx config and coordinator release.
"""
import datetime
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tarfile
import urllib.request

def run(*args):
    subprocess.run(args, check=True)

source = pathlib.Path(sys.argv[1]).resolve()
assert source.is_dir() and source.parent == pathlib.Path('/home/administrator')
assert (source / 'coordinator/server.cjs').is_file()
root = pathlib.Path('/opt/freep2pagent')
root.mkdir(exist_ok=True)
runtime = root / 'runtime'
runtime.mkdir(exist_ok=True)
node = runtime / 'current/bin/node'
if not node.exists():
    base = 'https://nodejs.org/dist/latest-v24.x/'
    checksums = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=30).read().decode()
    checksum, archive_name = next(line.split() for line in checksums.splitlines() if line.endswith('-linux-x64.tar.xz'))
    archive = runtime / archive_name
    with urllib.request.urlopen(base + archive_name, timeout=60) as response, archive.open('wb') as output:
        shutil.copyfileobj(response, output)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == checksum, 'Node runtime checksum mismatch'
    with tarfile.open(archive) as package:
        package.extractall(runtime, filter='data')
    (runtime / 'current').symlink_to(runtime / archive_name.removesuffix('.tar.xz'))
run(str(node), '--version')
release = root / 'releases' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
release.mkdir(parents=True)
for folder in ['coordinator', 'shared']:
    shutil.copytree(source / folder, release / folder)
(release / 'package.json').write_text(json.dumps({'name': 'freep2pagent-coordinator', 'version': '0.1.0', 'private': True, 'dependencies': {'ws': '8.22.0'}}))
run(str(node), str(runtime / 'current/lib/node_modules/npm/bin/npm-cli.js'), 'install', '--omit=dev', '--ignore-scripts', '--prefix', str(release))
if subprocess.run(['id', 'freep2pagent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    run('useradd', '--system', '--home-dir', str(root), '--shell', '/usr/sbin/nologin', 'freep2pagent')
current = root / 'current'
previous = current.resolve() if current.exists() else None
if previous:
    (root / 'previous-release').write_text(str(previous))
temporary = root / 'next'
temporary.symlink_to(release)
temporary.replace(current)
config = pathlib.Path('/etc/freep2pagent')
config.mkdir(mode=0o750, exist_ok=True)
env = config / 'coordinator.env'
if not env.exists():
    secret = secrets.token_hex(32)
    env.write_text('PORT=4390\nHOST=127.0.0.1\nTURN_SECRET=' + secret + '\nTURN_URLS=turn:208.110.72.147:3478?transport=udp,turn:208.110.72.147:3478?transport=tcp\n')
    env.chmod(0o600)
else:
    secret = next(line.split('=', 1)[1] for line in env.read_text().splitlines() if line.startswith('TURN_SECRET='))
    env.write_text('\n'.join(line for line in env.read_text().splitlines() if not line.startswith('STUN_URL=')) + '\n')
service = '''[Unit]
Description=FreeP2PAgent coordinator
After=network-online.target
[Service]
User=freep2pagent
Group=freep2pagent
WorkingDirectory=/opt/freep2pagent/current
ExecStart=/opt/freep2pagent/runtime/current/bin/node /opt/freep2pagent/current/coordinator/server.cjs
EnvironmentFile=/etc/freep2pagent/coordinator.env
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=256M
LimitNOFILE=4096
[Install]
WantedBy=multi-user.target
'''
pathlib.Path('/etc/systemd/system/freep2pagent.service').write_text(service)
nginx = pathlib.Path('/etc/nginx/sites-available/freep2pagent')
original = nginx.read_text() if nginx.exists() else ''
backup = root / ('nginx-' + release.name + '.conf')
backup.write_text(original)
location = '''    location / {
        proxy_pass http://127.0.0.1:4390/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_buffering off;
    }

'''
webroot = pathlib.Path('/var/lib/freep2pagent-acme')
webroot.mkdir(exist_ok=True)
http_config = '''server {
    listen 80;
    server_name freep2pagent.thinkelution.com;
    location /.well-known/acme-challenge/ { root /var/lib/freep2pagent-acme; }
    location / { return 301 https://$host$request_uri; }
}
'''
nginx.write_text(original or http_config)
enabled = pathlib.Path('/etc/nginx/sites-enabled/freep2pagent')
if not enabled.exists():
    enabled.symlink_to(nginx)
try:
    run('nginx', '-t')
except Exception:
    nginx.write_text(original)
    raise
run('systemctl', 'daemon-reload')
run('systemctl', 'enable', 'freep2pagent')
run('systemctl', 'restart', 'freep2pagent')
run('systemctl', 'reload', 'nginx')
run('certbot', 'certonly', '--webroot', '-w', str(webroot), '-d', 'freep2pagent.thinkelution.com', '--non-interactive', '--agree-tos', '--register-unsafely-without-email', '--keep-until-expiring')
nginx.write_text(http_config + '''server {
    listen 443 ssl;
    server_name freep2pagent.thinkelution.com;
    ssl_certificate /etc/letsencrypt/live/freep2pagent.thinkelution.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/freep2pagent.thinkelution.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
''' + location + '}\n')
run('nginx', '-t')
run('systemctl', 'reload', 'nginx')
renewal = pathlib.Path('/etc/letsencrypt/renewal-hooks/deploy/freep2pagent-reload.sh')
renewal.parent.mkdir(parents=True, exist_ok=True)
renewal.write_text('#!/bin/sh\nnginx -t && systemctl reload nginx\n')
renewal.chmod(0o755)
print('Coordinator installed at', release)

# A dedicated relay uses separate config and service, not the distro default.
if not shutil.which('turnserver'):
    run('apt-get', 'update', '-qq')
    run('apt-get', 'install', '-y', 'coturn')
    run('systemctl', 'disable', '--now', 'coturn')
turn = config / 'turnserver.conf'
turn.write_text('''listening-port=3478
listening-ip=208.110.72.147
relay-ip=208.110.72.147
min-port=49160
max-port=49200
fingerprint
use-auth-secret
static-auth-secret=''' + secret + '''
realm=freep2pagent
server-name=freep2pagent
user-quota=4
total-quota=100
max-bps=2500000
bps-capacity=20000000
stale-nonce=600
no-cli
userdb=/var/lib/freep2pagent-turn/turndb
no-tls
no-dtls
no-multicast-peers
no-tcp-relay
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
''')
turn.chmod(0o640)
shutil.chown(config, group='freep2pagent')
shutil.chown(turn, group='freep2pagent')
pathlib.Path('/etc/systemd/system/freep2pagent-relay.service').write_text('''[Unit]
Description=FreeP2PAgent authenticated TURN relay
After=network-online.target
[Service]
User=freep2pagent
Group=freep2pagent
ExecStart=/usr/bin/turnserver -c /etc/freep2pagent/turnserver.conf --pidfile=
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
MemoryMax=256M
StateDirectory=freep2pagent-turn
[Install]
WantedBy=multi-user.target
''')
run('systemctl', 'daemon-reload')
run('systemctl', 'enable', 'freep2pagent-relay')
run('systemctl', 'restart', 'freep2pagent-relay')
print('Relay configured; validate authenticated external connectivity before claiming availability.')
