"""Create only FreeP2PAgent's authorized DNS record; never print credentials."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.request
import urllib.error

parser = argparse.ArgumentParser()
parser.add_argument('--credentials-file', type=Path)
args = parser.parse_args()
token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
if not token and args.credentials_file:
    match = re.search(r'^\s*cloudf+lare\s*[:=]\s*(.+)$', args.credentials_file.read_text(), re.M | re.I)
    if match:
        token = match.group(1).strip().strip('\"\'')
if not token:
    raise SystemExit('Cloudflare token not available')

def call(path, data=None):
    request = urllib.request.Request('https://api.cloudflare.com/client/v4/' + path, data=json.dumps(data).encode() if data else None, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit('Cloudflare request failed: HTTP ' + str(error.code)) from None
    if not result.get('success'):
        raise SystemExit('Cloudflare operation failed')
    return result['result']

zones = call('zones?name=thinkelution.com')
assert len(zones) == 1 and zones[0]['name'] == 'thinkelution.com'
base = 'zones/' + zones[0]['id'] + '/dns_records'
name = 'freep2pagent.thinkelution.com'
records = call(base + '?name=' + name)
if records:
    assert len(records) == 1 and records[0]['type'] == 'A' and records[0]['content'] == '208.110.72.147' and not records[0]['proxied'], 'Existing record differs; refusing to overwrite'
    record = records[0]
else:
    record = call(base, {'type': 'A', 'name': name, 'content': '208.110.72.147', 'proxied': False, 'ttl': 300})
print(json.dumps({k: record[k] for k in ['name', 'type', 'content', 'proxied']}))
