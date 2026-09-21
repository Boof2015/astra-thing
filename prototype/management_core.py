"""Management pairing and authorization, independent of desktop music pairing."""
# SPDX-License-Identifier: GPL-3.0-only
import hashlib
import hmac
import json
import secrets
import threading
import time
from client import save_connection
from hardware_pairing import EphemeralKey, b64, unb64

PROFILE = 'astra-thing-management-v1'

def transcript_key(ephemeral, peer, transcript):
    encoded = json.dumps(transcript, separators=(',', ':'), ensure_ascii=False).encode()
    secret = ephemeral.shared(peer)
    prk = hmac.digest(hashlib.sha256(encoded).digest(), secret, 'sha256')
    key = hmac.digest(prk, b'astra-thing-management-key\x01', 'sha256')
    code = str(int.from_bytes(hmac.digest(key, b'code' + encoded, 'sha256')[:4], 'big') % 1000000).zfill(6)
    proof = b64(hmac.digest(key, b'proof' + encoded, 'sha256'))
    return code, proof

class Conflict(ValueError):
    pass

class Pairing:
    def __init__(self, path, identity, certificate, clock=time.monotonic):
        self.path, self.identity, self.certificate, self.clock = path, identity, certificate, clock
        self.lock = threading.RLock()
        self.pending = None
        self.attempts = []
        self.managers = json.loads(path.read_text()) if path.exists() else []
        if not isinstance(self.managers, list) or len(self.managers) > 8:
            raise ValueError('Invalid manager store')

    def expire(self):
        if self.pending and self.pending['expires'] <= self.clock():
            self.pending['ephemeral'].close()
            self.pending = None

    def request(self, data):
        label = data.get('label')
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 80 or any(ord(c) < 32 for c in label):
            raise ValueError('Invalid manager name')
        public, nonce = data.get('publicKey'), data.get('nonce')
        if len(unb64(public, 256)) < 65 or len(unb64(nonce, 32)) != 32:
            raise ValueError('Invalid manager key')
        with self.lock:
            self.expire()
            if self.pending:
                if self.pending['clientPublic'] == public and self.pending['clientNonce'] == nonce:
                    return self.pending['response']
                raise Conflict('Another management request is waiting for approval')
            self.attempts = [stamp for stamp in self.attempts if stamp > self.clock() - 600]
            if len(self.attempts) >= 8:
                raise Conflict('Too many pairing attempts; try again later')
            if len(self.managers) >= 8:
                raise Conflict('Forget existing managers on the Thing before adding another')
            self.attempts.append(self.clock())
            ephemeral = EphemeralKey()
            request_id, server_nonce = secrets.token_hex(16), b64(secrets.token_bytes(32))
            transcript = [PROFILE, request_id, self.identity, self.certificate, label.strip(), public, nonce, ephemeral.public, server_nonce]
            try:
                code, proof = transcript_key(ephemeral, public, transcript)
            except Exception:
                ephemeral.close()
                raise
            response = {'profile': PROFILE, 'id': request_id, 'deviceId': self.identity, 'certificate': self.certificate,
                        'label': label.strip(), 'publicKey': ephemeral.public, 'nonce': server_nonce, 'expiresIn': 90}
            self.pending = {'id': request_id, 'clientPublic': public, 'clientNonce': nonce, 'label': label.strip(),
                            'ephemeral': ephemeral, 'expires': self.clock() + 90, 'approved': False, 'code': code,
                            'proof': proof, 'response': response, 'credential': None}
            return response

    def snapshot(self):
        with self.lock:
            self.expire()
            pending = self.pending
            if not pending or pending['credential']:
                return None
            return {'id': pending['id'], 'label': pending['label'], 'code': pending['code'],
                    'expiresIn': max(0, int(pending['expires'] - self.clock())), 'approved': pending['approved']}

    def approve(self, request_id, code):
        with self.lock:
            self.expire()
            if not self.pending or self.pending['id'] != request_id or self.pending['code'] != code:
                raise Conflict('The management request changed or expired')
            self.pending['approved'] = True

    def reject(self, request_id):
        with self.lock:
            self.expire()
            if self.pending and self.pending['id'] == request_id:
                self.pending['ephemeral'].close()
                self.pending = None

    def finish(self, data):
        with self.lock:
            self.expire()
            pending = self.pending
            if not pending or pending['id'] != data.get('id'):
                raise Conflict('Management request expired')
            supplied = data.get('proof', '')
            if not isinstance(supplied, str) or not hmac.compare_digest(pending['proof'], supplied):
                raise ValueError('Invalid management possession proof')
            if not pending['approved']:
                raise Conflict('Approve this computer on your Thing')
            if not pending['credential']:
                token, manager_id = b64(secrets.token_bytes(32)), secrets.token_hex(16)
                managers = self.managers + [{'id': manager_id, 'label': pending['label'], 'tokenHash': hashlib.sha256(token.encode()).hexdigest()}]
                save_connection(self.path, managers)
                self.managers = managers
                pending['credential'] = {'managerId': manager_id, 'token': token, 'deviceId': self.identity}
            return pending['credential']

    def cancel(self, data):
        with self.lock:
            self.expire()
            pending = self.pending
            proof = data.get('proof')
            if pending and pending['id'] == data.get('id') and isinstance(proof, str) and hmac.compare_digest(pending['proof'], proof):
                self.reject(pending['id'])
            else:
                raise ValueError('Invalid cancellation proof')

    def authorize(self, header):
        if not isinstance(header, str) or not header.startswith('Bearer ') or len(header) > 100:
            return None
        digest = hashlib.sha256(header[7:].encode()).hexdigest()
        with self.lock:
            return next((manager['id'] for manager in self.managers if hmac.compare_digest(digest, manager.get('tokenHash', ''))), None)

    def forget_all(self):
        with self.lock:
            if self.pending:
                self.pending['ephemeral'].close()
                self.pending = None
            save_connection(self.path, [])
            self.managers = []
