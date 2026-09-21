#!/usr/bin/env python3
"""USB-only maintenance with physical approval and signed firmware updates."""
# SPDX-License-Identifier: GPL-3.0-only
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import ssl
import subprocess
import threading
import time
from management_core import Pairing, Conflict
from management_update import Updater
from management_local import SOCKET

ROOT = Path('/var/lib/astra-thing/management')
APP = Path(__file__).resolve().parent
PORT = 8843

class BoundedServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    def __init__(self, *args, **kwargs):
        self.clients = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)
    def process_request(self, request, address):
        if not self.clients.acquire(False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.clients.release()
            raise
    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.clients.release()
    def get_request(self):
        stream, address = self.socket.accept()
        stream.settimeout(12)
        if getattr(self, 'tls', None):
            try:
                if ipaddress.ip_address(address[0]) not in self.network:
                    raise OSError('USB peer required')
                stream = self.tls.wrap_socket(stream, server_side=True, do_handshake_on_connect=False)
            except Exception:
                stream.close()
                raise
        return stream, address

class UnixServer(BoundedServer):
    address_family = socket.AF_UNIX
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = 'localhost', 0

class Service:
    def __init__(self):
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(ROOT, 0o700)
        self.version = json.loads(Path('/etc/astra-thing-release.json').read_text())
        serial = Path('/sys/firmware/devicetree/base/serial-number').read_bytes().rstrip(b'\0')
        self.device_id = hashlib.sha256(b'astra-thing:' + serial).hexdigest()[:32]
        key, cert = ROOT / 'tls-key.pem', ROOT / 'tls-cert.pem'
        if not key.exists() and not cert.exists():
            subprocess.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
                            '-nodes', '-days', '36500', '-subj', '/CN=Astra Thing', '-keyout', str(key), '-out', str(cert)],
                           check=True, capture_output=True, timeout=30)
            os.chmod(key, 0o600)
        fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
        self.pairing = Pairing(ROOT / 'managers.json', self.device_id, fingerprint)
        self.updater = Updater(ROOT, json.loads((APP / 'trusted-keys.json').read_text()), (APP / 'sw-description.template').read_text(), self.version)
        self.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.tls.minimum_version = ssl.TLSVersion.TLSv1_2
        self.tls.load_cert_chain(cert, key)
        self.ready_at = 0
        self.healthy_since = None

    def identity(self):
        return {'profile': 'astra-thing-management-v1', 'modelId': 'astra-thing', 'deviceId': self.device_id,
                'name': 'Astra Thing', **{k: self.version[k] for k in ('version', 'build')},
                'healthy': Path('/run/astra-thing-healthy').exists() and time.monotonic() - self.ready_at < 15}

    def health(self):
        started, marked, reboot_requested = time.monotonic(), False, False
        while True:
            healthy = time.monotonic() - self.ready_at < 15
            self.healthy_since = self.healthy_since or time.monotonic() if healthy else None
            stable = self.healthy_since is not None and time.monotonic() - self.healthy_since >= 20
            self.updater.confirm_boot(stable)
            if stable and not marked:
                result = subprocess.run(['/usr/libexec/astra-thing-mark-good'], capture_output=True)
                marked = result.returncode == 0
            if not marked and not reboot_requested and time.monotonic() - started > 150:
                reboot_requested = True
                subprocess.run(['systemctl', 'reboot'], capture_output=True)
            time.sleep(2)

def handler(service, local=False):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.0'
        def log_message(self, *args):
            pass
        def send(self, status, body):
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(payload)
        def body(self):
            if self.headers.get('Content-Type') != 'application/json':
                raise ValueError('Expected JSON')
            size = self.length(150000)
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Expected an object')
            return data
        def length(self, maximum):
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                raise ValueError('Explicit content length required')
            size = int(self.headers['Content-Length'])
            if not 0 < size <= maximum:
                raise ValueError('Invalid request length')
            return size
        def do_GET(self):
            self.dispatch(False)
        def do_POST(self):
            self.dispatch(True)
        def dispatch(self, post):
            try:
                if self.headers.get('Origin') or self.headers.get('Transfer-Encoding'):
                    return self.send(403, {'error': 'Use Astra Thing Manager'})
                if local:
                    if not post:
                        return self.send(405, {'error': 'POST required'})
                    data = self.body()
                    if self.path == '/pending':
                        result = service.pairing.snapshot()
                    elif self.path == '/ready':
                        service.ready_at = time.monotonic()
                        result = {'ready': True}
                    elif self.path == '/approve':
                        service.pairing.approve(data.get('id'), data.get('code'))
                        result = {'approved': True}
                    elif self.path == '/reject':
                        service.pairing.reject(data.get('id'))
                        result = {'rejected': True}
                    elif self.path == '/forget':
                        service.pairing.forget_all()
                        result = {'forgotten': True}
                    else:
                        return self.send(404, {'error': 'Unknown action'})
                    return self.send(200, result)
                if self.path == '/v1/identity' and not post:
                    return self.send(200, service.identity())
                if self.path == '/v1/pair/request' and post:
                    return self.send(200, service.pairing.request(self.body()))
                if self.path == '/v1/pair/finish' and post:
                    return self.send(200, service.pairing.finish(self.body()))
                if self.path == '/v1/pair/cancel' and post:
                    service.pairing.cancel(self.body())
                    return self.send(200, {'cancelled': True})
                owner = service.pairing.authorize(self.headers.get('Authorization'))
                if not owner:
                    return self.send(401, {'error': 'Approve this computer on your Thing'})
                if self.path == '/v1/status' and not post:
                    return self.send(200, {**service.identity(), 'operation': service.updater.snapshot()})
                if self.path == '/v1/update' and post:
                    return self.send(200, service.updater.prepare(self.body(), owner))
                if re.fullmatch(r'/v1/update/[a-f0-9]{32}', self.path) and post:
                    return self.send(200, service.updater.receive(self.path.rsplit('/', 1)[1], owner, self.rfile, self.length(600 * 1024**2)))
                if self.path == '/v1/restart' and post:
                    if self.body().get('confirmation') != 'restart':
                        raise ValueError('Restart not confirmed')
                    job = service.updater.snapshot()
                    if job and job['phase'] in ('receiving', 'checking', 'installing', 'restarting'):
                        raise Conflict('Wait for the update to finish')
                    self.send(200, {'restarting': True})
                    subprocess.Popen(['systemctl', 'reboot'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return
                self.send(404, {'error': 'Unknown action'})
            except Conflict as error:
                self.send(410 if str(error) == 'Management request expired' else 409, {'error': str(error)})
            except (ValueError, TypeError, KeyError, UnicodeError):
                self.send(400, {'error': 'Request could not be verified'})
            except (OSError, subprocess.SubprocessError):
                self.send(503, {'error': 'Device maintenance is unavailable'})
    return Handler

def usb_network():
    config = Path('/run/systemd/network/11-usb-ncm.network').read_text()
    match = re.search(r'^Address=(10\.42\.1\.\d+/29)$', config, re.M)
    if not match:
        raise ValueError('USB network address unavailable')
    return ipaddress.ip_interface(match[1])

def main():
    os.umask(0o077)
    service = Service()
    address = usb_network()
    server = BoundedServer((str(address.ip), PORT), handler(service))
    server.tls, server.network = service.tls, address.network
    socket_path = Path(SOCKET)
    socket_path.unlink(missing_ok=True)
    local = UnixServer(SOCKET, handler(service, local=True))
    os.chmod(SOCKET, 0o600)
    threading.Thread(target=local.serve_forever, daemon=True).start()
    threading.Thread(target=service.health, daemon=True).start()
    announcement = subprocess.Popen(['avahi-publish-service', 'Astra Thing ' + service.device_id[:8], '_astra-thing._tcp', str(PORT),
                                      'profile=astra-thing-management-v1', 'modelId=astra-thing', 'deviceId=' + service.device_id,
                                      'address=' + str(address.ip)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        server.serve_forever()
    finally:
        announcement.terminate()
        local.shutdown()
        socket_path.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
