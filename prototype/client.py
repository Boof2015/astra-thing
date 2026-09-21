#!/usr/bin/env python3
"""Small on-device Astra client. Desktop traffic uses pinned HTTPS and API v2."""
import argparse
import hashlib
import hmac
from http.client import HTTPSConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import selectors
import ssl
import struct
import sys
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit

STATE = Path('/var/lib/astra-thing/connection.json')
WEB = Path(__file__).parent / 'web'
ORIGIN = 'http://127.0.0.1:8080'


def fingerprint(value):
    value = value.replace(':', '').lower()
    if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Invalid certificate fingerprint')
    return value


def save_connection(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.new')
    fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class PinnedConnection(HTTPSConnection):
    def __init__(self, config, timeout=8):
        target = urlsplit(config['base_url'])
        if target.scheme != 'https' or not target.hostname or target.username or target.password or target.query or target.fragment or target.path not in ('', '/'):
            raise ValueError('Expected a plain HTTPS server address')
        self.expected = fingerprint(config['fingerprint'])
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        # Astra uses a self-signed identity. Verify its exact certificate below,
        # before http.client can send the request or its Authorization header.
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        super().__init__(target.hostname, target.port or 443, timeout=timeout, context=context)

    def connect(self):
        super().connect()
        actual = hashlib.sha256(self.sock.getpeercert(binary_form=True)).hexdigest()
        if not hmac.compare_digest(actual, self.expected):
            self.close()
            raise ssl.SSLError('Astra certificate changed; pair again')


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Api:
    def __init__(self, config):
        self.config = config

    def open(self, method, path, body=None, timeout=8):
        connection = PinnedConnection(self.config, timeout)
        headers = {'Accept': 'application/json'}
        if self.config.get('token'):
            headers['Authorization'] = 'Bearer ' + self.config['token']
        if body is not None:
            headers['Content-Type'] = 'application/json'
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, headers)
            response = connection.getresponse()
            if response.status >= 300:
                # Never follow redirects carrying a device credential.
                response.read(65536)
                raise ApiError(response.status, f'Astra returned HTTP {response.status}')
            return connection, response
        except Exception:
            connection.close()
            raise

    def request(self, method, path, body=None):
        connection, response = self.open(method, path, body)
        try:
            data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise ValueError('Oversized API response')
            return json.loads(data)
        finally:
            connection.close()


def pair(link, path):
    url = urlsplit(link.strip())
    if url.scheme == 'astra' and url.netloc == 'desktop-remote':
        params = parse_qs(url.query)
        base = params['baseUrl'][0]
        ticket = params['ticket'][0]
    elif url.scheme == 'https' and url.path.startswith('/remote'):
        params = parse_qs(url.fragment)
        base = f'https://{url.netloc}'
        ticket = params['pair'][0]
    else:
        raise ValueError('Use a pairing link copied from Astra')
    config = {'base_url': base, 'fingerprint': fingerprint(params['fingerprint'][0])}
    api = Api(config)
    request = api.request('POST', '/v1/pairing/claim', {
        'ticket': ticket, 'deviceName': 'Astra Car Thing', 'clientLabel': 'Astra Thing prototype',
        'requestedScopes': ['observe', 'playback-control']})
    print('Pairing requested. Approve Astra Car Thing in Astra.', flush=True)
    for _ in range(180):
        result = api.request('GET', '/v1/pairing/status?pollToken=' + quote(request['pollToken'], safe=''))
        if result['state'] == 'approved':
            if fingerprint(result['certificateFingerprint']) != config['fingerprint']:
                raise ValueError('Pairing identity mismatch')
            config.update(token=result['controlToken'], device_id=result['deviceId'],
                          scopes=result['scopes'], desktop_name=result['identity']['desktopName'])
            save_connection(path, config)
            print('Paired and saved on the Car Thing. Granted scopes:', ', '.join(result['scopes']), flush=True)
            return
        if result['state'] != 'pending':
            raise ValueError('Pairing ended: ' + result['state'])
        time.sleep(1)
    raise TimeoutError('Pairing approval timed out')


def playback_events(response, maximum=65536):
    event, lines, length = '', [], 0
    while raw := response.readline(maximum + 1):
        if len(raw) > maximum:
            raise ValueError('Oversized event line')
        line = raw.decode('utf-8').rstrip('\r\n')
        if not line:
            if lines:
                yield event, json.loads('\n'.join(lines))
            event, lines, length = '', [], 0
        elif line.startswith('event:'):
            event = line[6:].strip()
        elif line.startswith('data:'):
            lines.append(line[5:].lstrip(' '))
            length += len(line)
            if length > max(maximum, 1024 * 1024):
                raise ValueError('Oversized event')


class Client:
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.command_lock = threading.Lock()
        self.api = None
        self.playback = None
        self.scopes = []
        self.connected = False
        self.message = 'Pair this Car Thing with Astra'
        self.art_cache = None
        self.volume_delta = 0
        self.inputs = []
        self.last_control = None
        self.events_received = 0
        self.input_changed = threading.Condition(self.lock)
        self.input_sequence = 0
        self.input_events = []
        self.input_owner = 0

    def snapshot(self):
        with self.lock:
            return {'connected': self.connected, 'message': self.message,
                    'playback': self.playback, 'controls': self.connected and 'playback-control' in self.scopes,
                    'inputs': list(self.inputs), 'lastControl': self.last_control,
                    'eventsReceived': self.events_received}

    def observe(self):
        while True:
            connection = None
            try:
                config = json.loads(self.path.read_text())
                api = Api(config)
                # Use Astra's session clock for rotation; the device has no RTC.
                try:
                    api.request('GET', '/v1/session')
                except ApiError as error:
                    if error.status != 401:
                        raise
                    # The rotation endpoint also accepts a credential whose
                    # age now blocks ordinary API calls. Revoked keys fail here.
                    rotated = api.request('POST', '/v1/session/rotate', {})
                    config['token'] = rotated['controlToken']
                    save_connection(self.path, config)
                capabilities = api.request('GET', '/v2/capabilities')
                playback = api.request('GET', '/v2/playback')
                with self.lock:
                    self.api, self.scopes, self.playback = api, capabilities['grantedScopes'], playback
                    self.connected, self.message = True, 'Connected to Astra over USB'
                print('Connected to Astra; observing API v2 playback.', flush=True)
                connection, response = api.open('GET', '/v2/events?topics=playback&positionIntervalMs=1000', timeout=45)
                for event, data in playback_events(response):
                    with self.lock:
                        if event == 'playback':
                            self.playback = data
                            self.events_received += 1
                        elif event == 'capabilities':
                            self.scopes = data['grantedScopes']
                raise ConnectionError('Event stream closed')
            except Exception as error:
                with self.lock:
                    self.connected = False
                    self.volume_delta = 0
                    self.message = ('Pair this Car Thing with Astra' if not self.path.exists() else
                                    'Pair again in Astra' if isinstance(error, ApiError) and error.status == 401 else
                                    'Astra identity changed — pair again' if isinstance(error, ssl.SSLError) else
                                    'Waiting for Astra over USB')
                print(f'Connection unavailable: {type(error).__name__}', flush=True)
                time.sleep(3)
            finally:
                if connection:
                    connection.close()

    def command(self, body):
        with self.command_lock:
            with self.lock:
                if not self.connected or 'playback-control' not in self.scopes:
                    raise ApiError(503, 'Playback controls are unavailable')
                action = body.get('action')
                if action == 'toggle':
                    action = 'pause' if self.playback['state'] == 'playing' else 'play'
                payload = {'action': action}
                if action == 'set-volume':
                    volume = body.get('volume')
                    if isinstance(volume, bool) or not isinstance(volume, (int, float)) or not math.isfinite(volume) or not 0 <= volume <= 1:
                        raise ValueError('Volume must be between zero and one')
                    payload['volume'] = volume
                elif action == 'seek':
                    position = body.get('positionSeconds')
                    if isinstance(position, bool) or not isinstance(position, (int, float)) or not math.isfinite(position) or position < 0:
                        raise ValueError('Invalid seek position')
                    track_ref = ((self.playback or {}).get('currentTrack') or {}).get('ref')
                    if not track_ref or body.get('trackRef') != track_ref:
                        raise ApiError(409, 'Track changed while seeking')
                    payload['positionSeconds'] = min(position, self.playback.get('durationSeconds') or position)
                elif action == 'set-shuffle':
                    if not isinstance(body.get('enabled'), bool):
                        raise ValueError('Expected shuffle state')
                    payload['enabled'] = body['enabled']
                elif action == 'set-repeat':
                    if body.get('mode') not in ('none', 'one', 'all'):
                        raise ValueError('Invalid repeat mode')
                    payload['mode'] = body['mode']
                elif action not in ('play', 'pause', 'next', 'previous'):
                    raise ValueError('Unsupported prototype action')
                api = self.api
            result = api.request('POST', '/v2/playback/actions', payload)
            with self.lock:
                self.last_control = payload
            return result

    def artwork(self):
        with self.lock:
            track = (self.playback or {}).get('currentTrack') or {}
            path = track.get('artworkUrl')
            if not self.connected or not path:
                raise ApiError(404, 'No artwork')
            if self.art_cache and self.art_cache[0] == path:
                return self.art_cache[1:]
            if not path.startswith('/v2/artwork/'):
                raise ValueError('Unexpected artwork path')
            api = self.api
        connection, response = api.open('GET', path)
        try:
            data = response.read(2 * 1024 * 1024 + 1)
            mime = response.getheader('Content-Type', '').split(';')[0]
            if len(data) > 2 * 1024 * 1024 or mime not in ('image/png', 'image/jpeg', 'image/webp'):
                raise ValueError('Invalid thumbnail')
        finally:
            connection.close()
        with self.lock:
            self.art_cache = (path, mime, data)
        return mime, data

    def input_event(self, source, kind, code, value):
        # One input owner: the UI maps hardware events according to its current
        # view. GPIO keyboard defaults are suppressed there to avoid double actions.
        data = None
        if source == 'rotary' and kind == 2 and code == 6 and value:
            data = {'type': 'dial', 'delta': value}
        elif source == 'gpio-keys-polled' and kind == 1 and value == 1:
            key = {28: 'press', 2: 'playing', 3: 'queue', 4: 'playlists',
                   5: 'search', 1: 'back', 50: 'settings'}.get(code)
            if key:
                data = {'type': 'key', 'key': key}
        if data:
            with self.input_changed:
                self.input_sequence += 1
                self.input_events.append((self.input_sequence, time.monotonic(), data))
                self.input_events = self.input_events[-64:]
                self.input_changed.notify_all()

    def input_loop(self):
        event = struct.Struct('@llHHi')
        selector = selectors.DefaultSelector()
        for node, expected in (('event0', 'gpio-keys-polled'), ('event1', 'rotary')):
            try:
                if Path(f'/sys/class/input/{node}/device/name').read_text().strip() != expected:
                    continue
                stream = open('/dev/input/' + node, 'rb', buffering=0)
                selector.register(stream, selectors.EVENT_READ, expected)
                self.inputs.append(expected)
            except OSError:
                pass
        while True:
            for key, _ in selector.select(0.1):
                data = key.fileobj.read(event.size)
                if len(data) != event.size:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                _, _, kind, code, value = event.unpack(data)
                self.input_event(key.data, kind, code, value)


def handler(client):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, status, data, mime='application/json'):
            if not isinstance(data, bytes):
                data = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            return self.headers.get('Host') == '127.0.0.1:8080' and self.headers.get('Origin', ORIGIN) == ORIGIN

        def input_stream(self):
            # Start at the tail even on reconnect. Old presses must never replay.
            with client.lock:
                cursor = client.input_sequence
                client.input_owner += 1
                owner = client.input_owner
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(b'event: ready\ndata: {}\n\n')
                self.wfile.flush()
                while True:
                    with client.input_changed:
                        client.input_changed.wait_for(lambda: client.input_sequence > cursor, timeout=2)
                        now = time.monotonic()
                        events = [(seq, data) for seq, stamp, data in client.input_events
                                  if seq > cursor and now - stamp < 0.75]
                        cursor = client.input_sequence
                    if owner != client.input_owner:
                        return
                    for sequence, data in events:
                        self.wfile.write(f'id: {sequence}\nevent: input\ndata: {json.dumps(data)}\n\n'.encode())
                    if not events:
                        self.wfile.write(b': heartbeat\n\n')
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return

        def do_GET(self):
            if not self.allowed():
                self.send(403, {'error': 'Local UI only'})
                return
            url = urlsplit(self.path)
            path = url.path
            query = parse_qs(url.query)
            try:
                if path == '/state':
                    state = client.snapshot()
                    try:
                        from management_local import request
                        state['management'] = request('pending')
                    except OSError:
                        state['management'] = None
                    self.send(200, state)
                elif path == '/input-events':
                    self.input_stream()
                elif path == '/queue':
                    self.send(200, client.queue_snapshot())
                elif path == '/playlists':
                    self.send(200, client.playlist_page(query.get('cursor', [None])[0]))
                elif path == '/search':
                    self.send(200, client.search(query.get('q', [''])[0]))
                elif path == '/artwork':
                    mime, data = client.artwork(query.get('path', [None])[0])
                    self.send(200, data, mime)
                elif path in ('/', '/app.js', '/style.css', '/study.css', '/readability.css', '/character.css', '/language.css', '/companion.css', '/queue.css', '/search.css', '/browse.js', '/system.js', '/assets/artwork-fallback.svg', '/assets/pixel-heart.svg', '/assets/astra-wordmark.svg', '/assets/astra-full.svg'):
                    name = 'index.html' if path == '/' else path.lstrip('/')
                    mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}[Path(name).suffix]
                    self.send(200, (WEB / name).read_bytes(), mime)
                else:
                    self.send(404, {'error': 'Not found'})
            except (OSError, ValueError, ApiError):
                self.send(503, {'error': 'Content unavailable'})

        def do_POST(self):
            if not self.allowed() or self.path not in ('/action', '/music', '/preferences', '/wake', '/device', '/pair/discover', '/pair/start', '/pair/cancel', '/reconnect', '/manager/approve', '/manager/reject', '/manager/forget', '/ui/ready') or self.headers.get('Content-Type') != 'application/json':
                self.send(403, {'error': 'Local UI only'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 8192:
                    raise ValueError('Invalid request size')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError('Expected action object')
                if self.path.startswith('/manager/') or self.path == '/ui/ready':
                    from management_local import request
                    result = request(self.path.rsplit('/', 1)[1], body)
                elif self.path == '/action':
                    result = client.command(body)
                elif self.path == '/music':
                    result = client.music_action(body)
                elif self.path == '/preferences':
                    result = client.set_preferences(body)
                elif self.path == '/wake':
                    result = {'woke': client.wake()}
                elif self.path == '/device':
                    if body.get('action') == 'factory-reset' and body.get('confirmation') == 'factory-reset':
                        from management_local import request
                        try:
                            request('forget')
                        except OSError:
                            if Path('/etc/astra-thing-release.json').exists():
                                raise  # Do not report a reset while credentials survive.
                    result = client.device_action(body)
                elif self.path == '/pair/discover':
                    client.start_discovery()
                    result = {'accepted': True}
                elif self.path == '/pair/start':
                    client.start_pairing(body.get('hostId'))
                    result = {'accepted': True}
                elif self.path == '/pair/cancel':
                    client.cancel_pairing()
                    result = {'accepted': True}
                else:
                    with client.lock:
                        client.interrupt_observer()
                    result = {'accepted': True}
                self.send(202, result)
            except ValueError:
                self.send(400, {'error': 'Invalid action'})
            except ApiError as error:
                self.send(error.status if error.status in (400, 403, 404, 409, 429, 503) else 503, {'error': str(error)})
            except OSError:
                self.send(503, {'error': 'Astra is unavailable'})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('serve', 'pair'))
    parser.add_argument('--state', type=Path, default=STATE)
    args = parser.parse_args()
    if args.mode == 'pair':
        pair(sys.stdin.read(), args.state)
        return
    from device_client import DeviceClient
    client = DeviceClient(args.state)
    for target in (client.observe, client.input_loop, client.display_loop):
        threading.Thread(target=target, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', 8080), handler(client))
    print('Astra Thing prototype listening locally on port 8080.', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
