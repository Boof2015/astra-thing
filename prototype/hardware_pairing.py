"""Hardware-v1 code comparison using the device's existing OpenSSL runtime.

Crypto operations use OpenSSL; Python only encodes the documented transcript,
HKDF/HMAC and messages. No credential or private key is returned to the web UI.
"""
import base64
import ctypes
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import socket
import ssl
import subprocess
import sys
import tempfile

SCOPES = ['observe', 'playback-control', 'library-search']
DEVICE_INFO = {'modelId': 'astra-thing', 'softwareVersion': '0.3.0-dev'}
try:
    DEVICE_INFO['softwareVersion'] = json.loads(Path('/etc/astra-thing-release.json').read_text())['version']
except (OSError, ValueError, KeyError):
    pass


def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip('=')


def unb64(value, maximum=65536):
    if not isinstance(value, str) or len(value) > maximum * 2 or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('Invalid pairing encoding')
    data = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    if len(data) > maximum or b64(data) != value:
        raise ValueError('Invalid pairing encoding')
    return data


def decode_avahi(value):
    return re.sub(r'\\(\d{3})', lambda match: chr(int(match[1])), value)


def parse_discovery(output):
    hosts = {}
    for line in output.splitlines():
        fields = line.split(';', 9)
        if len(fields) != 10 or fields[0] != '=' or fields[2] != 'IPv4':
            continue
        try:
            address = ipaddress.ip_address(fields[7])
            if address.is_loopback or address.is_multicast or address.is_unspecified:
                continue
            port = int(fields[8])
            if not 1024 <= port <= 65535:
                continue
            txt = dict(decode_avahi(part).split('=', 1) for part in shlex.split(fields[9]) if '=' in part)
            if txt.get('hardware_pairing') != 'hardware-v1' or txt.get('transport') != 'https':
                continue
            endpoint = txt.get('endpoint_uuid', '')
            if not endpoint or len(endpoint) > 200:
                continue
            candidate = {'id': endpoint, 'name': txt.get('name', decode_avahi(fields[3]))[:80],
                         'base_url': f'https://{address}:{port}'}
            # Prefer the direct USB network when the same desktop advertises Wi-Fi.
            key = endpoint
            if key not in hosts or fields[1].startswith(('usb', 'enx')):
                hosts[key] = candidate
        except (ValueError, TypeError):
            continue
    return list(hosts.values())[:12]


def discover():
    try:
        result = subprocess.run(['avahi-browse', '-rtp', '_astra-remote._tcp'],
                                capture_output=True, timeout=8, check=False)
        output = result.stdout
    except subprocess.TimeoutExpired as error:
        output = error.stdout or b''
    return parse_discovery(output[:128 * 1024].decode('utf-8', errors='replace'))


def inspect_certificate(base_url):
    from urllib.parse import urlsplit
    target = urlsplit(base_url)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    # This first connection sends no HTTP or credentials. Trust is established
    # only after comparing independently derived codes in Astra and on the Thing.
    with socket.create_connection((target.hostname, target.port), timeout=5) as raw:
        with context.wrap_socket(raw, server_hostname=target.hostname) as connection:
            return hashlib.sha256(connection.getpeercert(binary_form=True)).hexdigest()


def openssl(*arguments):
    executable = '/opt/homebrew/opt/openssl@3/bin/openssl' if sys.platform == 'darwin' else '/usr/bin/openssl'
    result = subprocess.run([executable, *arguments], capture_output=True, timeout=8, check=False)
    if result.returncode:
        raise ValueError('Secure pairing key operation failed')
    return result.stdout


class EphemeralKey:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix='astra-pair-')
        self.private_path = Path(self.directory.name) / 'private.der'
        key = openssl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-outform', 'DER')
        with os.fdopen(os.open(self.private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
            stream.write(key)
        self.public = b64(openssl('pkey', '-inform', 'DER', '-in', str(self.private_path), '-pubout', '-outform', 'DER'))

    def shared(self, peer):
        peer_path = Path(self.directory.name) / 'peer.der'
        peer_path.write_bytes(unb64(peer, 256))
        secret = openssl('pkeyutl', '-derive', '-inkey', str(self.private_path), '-keyform', 'DER',
                         '-peerkey', str(peer_path), '-peerform', 'DER')
        if len(secret) != 32:
            raise ValueError('Unexpected ECDH key')
        return secret

    def close(self):
        self.directory.cleanup()


def derive_pairing(ephemeral, response, expected_fingerprint, candidate):
    from urllib.parse import urlsplit
    hardware = response.get('hardware') or {}
    identity = response.get('identity') or {}
    if (response.get('protocolVersion') != 3 or hardware.get('profile') != 'hardware-v1'
            or hardware.get('deviceName') != 'Astra Thing' or hardware.get('clientLabel') != 'Astra Thing'
            or hardware.get('requestedScopes') != SCOPES or identity.get('endpointUuid') != candidate['id']
            or response.get('certificateFingerprint', '').replace(':', '').lower() != expected_fingerprint):
        raise ValueError('Pairing identity or permissions changed')
    device_info = hardware.get('deviceInfo')
    if device_info is not None and device_info != DEVICE_INFO:
        raise ValueError('Device information changed during pairing')
    transcript = json.dumps([3, response['requestId'], ephemeral.public, response['desktopEphemeralPublicKey'],
                            expected_fingerprint.upper(), identity['endpointUuid'], urlsplit(candidate['base_url']).port,
                            'hardware-v1', 'Astra Thing', 'Astra Thing', SCOPES,
                            *([[device_info['modelId'], device_info['softwareVersion']]] if device_info else [])],
                           separators=(',', ':'), ensure_ascii=False).encode()
    secret = ephemeral.shared(response['desktopEphemeralPublicKey'])
    prk = hmac.digest(hashlib.sha256(transcript).digest(), secret, 'sha256')
    key = hmac.digest(prk, b'astra-phone-remote-v3-pairing\x01', 'sha256')
    code_bytes = hmac.digest(key, b'astra-phone-remote-v3-code' + transcript, 'sha256')
    code = str(int.from_bytes(code_bytes[:4], 'big') % 1000000).zfill(6)
    proof = b64(hmac.digest(key, b'astra-phone-remote-v3-proof' + transcript, 'sha256'))
    return key, transcript, code, proof


def decrypt_credentials(key, transcript, sealed):
    nonce, ciphertext, tag = (unb64(sealed[field]) for field in ('nonce', 'ciphertext', 'authTag'))
    if len(key) != 32 or len(nonce) != 12 or len(tag) != 16:
        raise ValueError('Invalid sealed pairing response')
    lib = ctypes.CDLL('/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib' if sys.platform == 'darwin' else 'libcrypto.so.3')
    pointer, integer = ctypes.c_void_p, ctypes.c_int
    signatures = {
        'EVP_CIPHER_CTX_new': (pointer, []), 'EVP_CIPHER_CTX_free': (None, [pointer]),
        'EVP_aes_256_gcm': (pointer, []),
        'EVP_DecryptInit_ex': (integer, [pointer, pointer, pointer, pointer, pointer]),
        'EVP_DecryptUpdate': (integer, [pointer, pointer, pointer, pointer, integer]),
        'EVP_DecryptFinal_ex': (integer, [pointer, pointer, pointer]),
        'EVP_CIPHER_CTX_ctrl': (integer, [pointer, integer, integer, pointer])}
    for name, (result, arguments) in signatures.items():
        function = getattr(lib, name)
        function.restype, function.argtypes = result, arguments
    context = lib.EVP_CIPHER_CTX_new()
    if not context:
        raise ValueError('Could not allocate cipher')
    output = ctypes.create_string_buffer(len(ciphertext) + 16)
    size, final_size = integer(), integer()
    def check(result):
        if result != 1:
            raise ValueError('Pairing response authentication failed')
    try:
        check(lib.EVP_DecryptInit_ex(context, lib.EVP_aes_256_gcm(), None, key, nonce))
        aad = b'astra-phone-remote-v3-confirm:' + hashlib.sha256(transcript).digest()
        check(lib.EVP_DecryptUpdate(context, None, ctypes.byref(size), aad, len(aad)))
        check(lib.EVP_DecryptUpdate(context, output, ctypes.byref(size), ciphertext, len(ciphertext)))
        check(lib.EVP_CIPHER_CTX_ctrl(context, 0x11, len(tag), tag))  # EVP_CTRL_AEAD_SET_TAG
        check(lib.EVP_DecryptFinal_ex(context, ctypes.byref(output, size.value), ctypes.byref(final_size)))
        return json.loads(output.raw[:size.value + final_size.value])
    finally:
        ctypes.memset(output, 0, len(output))
        lib.EVP_CIPHER_CTX_free(context)
