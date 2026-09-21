"""The live device bridge: pairing, music data, and device preferences."""
from collections import OrderedDict
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import ssl
import subprocess
import threading
import time
from urllib.parse import quote, urlencode
from client import Api, ApiError, Client, fingerprint, playback_events, save_connection
from hardware_pairing import DEVICE_INFO, SCOPES, EphemeralKey, decrypt_credentials, derive_pairing, discover, inspect_certificate

DEFAULTS = {'surface': 'light', 'albumColor': True, 'brightness': 100, 'idle': 120}
BACKLIGHT = Path('/sys/class/backlight/backlight')


class DeviceClient(Client):
    def __init__(self, path):
        super().__init__(path)
        self.preferences_path = path.with_name('preferences.json')
        self.preferences = dict(DEFAULTS)
        try:
            self.preferences.update(self.validate_preferences(json.loads(self.preferences_path.read_text())))
        except (OSError, ValueError, TypeError):
            pass
        self.config = None
        try:
            self.config = json.loads(path.read_text())
        except (OSError, ValueError):
            pass
        self.features = {}
        self.queue = []
        self.queue_revision = 0
        self.library_revision = 0
        self.hosts = []
        self.pairing = {'state': 'idle'}
        self.pair_generation = 0
        self.epoch = 0
        self.wake_observer = threading.Event()
        self.stream_connection = None
        self.last_discovery = 0
        self.last_activity = time.monotonic()
        self.dimmed = False
        self.started = time.monotonic()
        self.artworks = OrderedDict()
        self.artwork_slots = threading.Semaphore(3)
        self.apply_brightness()

    @staticmethod
    def validate_preferences(body):
        if not isinstance(body, dict) or any(key not in DEFAULTS for key in body):
            raise ValueError('Unknown preference')
        for key, value in body.items():
            if key == 'surface' and value not in ('light', 'dark'):
                raise ValueError('Invalid appearance')
            if key == 'albumColor' and type(value) is not bool:
                raise ValueError('Invalid album color setting')
            if key == 'brightness' and (type(value) is not int or not 25 <= value <= 100):
                raise ValueError('Invalid brightness')
            if key == 'idle' and (type(value) is not int or value not in (0, 30, 120)):
                raise ValueError('Invalid idle timeout')
        return body

    def snapshot(self):
        with self.lock:
            return {**super().snapshot(), 'softwareVersion': DEVICE_INFO['softwareVersion'], 'paired': bool(self.config),
                    'host': (self.config or {}).get('desktop_name'), 'scopes': list(self.scopes),
                    'features': dict(self.features), 'queueRevision': self.queue_revision,
                    'queueCount': len(self.queue), 'libraryRevision': self.library_revision,
                    'pairing': dict(self.pairing), 'preferences': dict(self.preferences),
                    'preferencesSaved': self.preferences_path.exists(), 'dimmed': self.dimmed,
                    'uptimeSeconds': int(time.monotonic() - self.started),
                    'displayAvailable': BACKLIGHT.exists()}

    def set_preferences(self, body):
        patch = self.validate_preferences(body)
        with self.lock:
            self.preferences.update(patch)
            save_connection(self.preferences_path, self.preferences)
            self.apply_brightness()
        return dict(self.preferences)

    def apply_brightness(self):
        try:
            maximum = int((BACKLIGHT / 'max_brightness').read_text())
            percent = 10 if self.dimmed else self.preferences['brightness']
            (BACKLIGHT / 'brightness').write_text(str(max(1, round(maximum * percent / 100))))
        except OSError:
            pass  # Local development has no device backlight.

    def wake(self):
        with self.lock:
            was_dimmed = self.dimmed
            self.last_activity = time.monotonic()
            self.dimmed = False
            if was_dimmed:
                self.apply_brightness()
            return was_dimmed

    def input_event(self, source, kind, code, value):
        actionable = source == 'rotary' and kind == 2 and value or source == 'gpio-keys-polled' and kind == 1 and value == 1
        if actionable and self.wake():
            return  # The first gesture wakes; it doesn't also change the music.
        super().input_event(source, kind, code, value)

    def display_loop(self):
        while True:
            with self.lock:
                idle = self.preferences['idle']
                pairing_active = self.pairing['state'] in ('discovering', 'connecting', 'approval')
                dim = bool(idle and not pairing_active and time.monotonic() - self.last_activity >= idle)
                if self.dimmed != dim:
                    self.dimmed = dim
                    self.apply_brightness()
            time.sleep(1)

    def interrupt_observer(self):
        self.epoch += 1
        self.connected = False
        self.api = None
        self.scopes = []
        self.queue = []
        self.queue_revision += 1
        self.artworks.clear()
        connection = self.stream_connection
        if connection and connection.sock:
            try:
                connection.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.wake_observer.set()

    def update_queue(self, snapshot):
        items = snapshot.get('items', [])
        current = next((index for index, item in enumerate(items) if item.get('current')), -1)
        upcoming = [item for item in items[current + 1:] if not item.get('current')]
        if upcoming != self.queue:
            self.queue = upcoming
            self.queue_revision += 1

    def observe(self):
        while True:
            connection = None
            self.wake_observer.clear()
            with self.lock:
                epoch = self.epoch
                config = dict(self.config) if self.config else None
            try:
                if not config:
                    raise FileNotFoundError()
                api = Api(config)
                try:
                    session = api.request('GET', '/v1/session')
                except ApiError as error:
                    if error.status != 401:
                        raise
                    rotated = api.request('POST', '/v1/session/rotate', {})
                    config['token'] = rotated['controlToken']
                    session = rotated
                config['endpoint_uuid'] = session.get('identity', {}).get('endpointUuid') or config.get('endpoint_uuid')
                # Presentation metadata uses the authenticated session; the saved
                # user-facing name and all pairing credentials stay unchanged.
                try:
                    api.request('POST', '/v1/session/device-info', DEVICE_INFO)
                except ApiError as error:
                    if error.status not in (404, 405):
                        raise
                capabilities = api.request('GET', '/v2/capabilities')
                playback = api.request('GET', '/v2/playback')
                queue = api.request('GET', '/v2/queue')
                with self.lock:
                    if epoch != self.epoch:
                        continue
                    if config != self.config:
                        save_connection(self.path, config)
                        self.config = config
                    self.api, self.scopes, self.playback = api, capabilities['grantedScopes'], playback
                    self.features = capabilities.get('features', {})
                    self.update_queue(queue)
                    self.connected, self.message = True, 'Connected to Astra'
                connection, response = api.open('GET', '/v2/events?topics=playback,queue,playlist&positionIntervalMs=1000', timeout=45)
                with self.lock:
                    self.stream_connection = connection
                for event, data in playback_events(response, maximum=8 * 1024 * 1024):
                    with self.lock:
                        if epoch != self.epoch:
                            break
                        if event == 'playback':
                            self.playback = data
                            self.events_received += 1
                        elif event == 'queue':
                            self.update_queue(data)
                        elif event == 'playlist':
                            self.library_revision += 1
                        elif event == 'capabilities':
                            self.scopes = data['grantedScopes']
                            self.features = data.get('features', {})
                raise ConnectionError('Event stream closed')
            except Exception as error:
                with self.lock:
                    if epoch == self.epoch:
                        self.connected = False
                        self.message = ('Pair with Astra' if not config else
                                        'Pair again in Astra' if isinstance(error, ApiError) and error.status == 401 else
                                        'Astra identity changed — pair again' if isinstance(error, ssl.SSLError) else
                                        'Waiting for Astra')
                # A remembered endpoint may move between USB addresses. Discovery
                # changes only its locator; the saved certificate pin is retained.
                if config and config.get('endpoint_uuid') and time.monotonic() - self.last_discovery > 12:
                    self.last_discovery = time.monotonic()
                    try:
                        match = next((host for host in discover() if host['id'] == config['endpoint_uuid']), None)
                        if match:
                            with self.lock:
                                if epoch == self.epoch and self.config:
                                    self.config['base_url'] = match['base_url']
                    except OSError:
                        pass
                self.wake_observer.wait(3)
            finally:
                if connection:
                    connection.close()
                with self.lock:
                    if self.stream_connection is connection:
                        self.stream_connection = None

    def api_for(self, scope='observe'):
        with self.lock:
            if not self.connected or scope not in self.scopes:
                raise ApiError(503, 'This control needs a connected Astra with the right permissions')
            return self.api

    def playlist_page(self, cursor=None):
        if cursor is not None and (not isinstance(cursor, str) or not 1 <= len(cursor) <= 2048):
            raise ValueError('Invalid playlist cursor')
        api = self.api_for('library-search')
        if not self.features.get('playlistListing'):
            raise ApiError(503, 'Update Astra to browse playlists')
        return api.request('GET', '/v2/playlists?' + urlencode({'limit': 3, **({'cursor': cursor} if cursor else {})}))

    def search(self, query):
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 64:
            raise ValueError('Enter a song or artist')
        return self.api_for('library-search').request('GET', '/v2/search?' + urlencode({'q': query.strip(), 'types': 'track', 'limit': 50}))

    def queue_snapshot(self):
        self.api_for()
        with self.lock:
            return {'items': list(self.queue), 'revision': self.queue_revision}

    def music_action(self, body):
        with self.command_lock:
            api = self.api_for('playback-control')
            action = body.get('action')
            if action in ('play', 'enqueue'):
                ref = body.get('ref')
                if not isinstance(ref, str) or not 1 <= len(ref) <= 2048 or not ref.startswith(('astra.track.', 'astra.playlist.')):
                    raise ValueError('Invalid music reference')
                if body.get('position', 'end') not in ('next', 'end'):
                    raise ValueError('Invalid queue destination')
                return api.request('POST', '/v2/intents', {'action': action, 'targetRef': ref, 'position': body.get('position', 'end')})
            if action not in ('remove', 'move', 'play-next'):
                raise ValueError('Unsupported music action')
            item_id = body.get('id')
            with self.lock:
                items = list(self.queue)
            if not isinstance(item_id, str) or not any(item['id'] == item_id for item in items):
                raise ApiError(409, 'That track is no longer upcoming')
            path = '/v2/queue/items/' + quote(item_id, safe='')
            if action == 'remove':
                return api.request('DELETE', path)
            rest = [item for item in items if item['id'] != item_id]
            before = body.get('beforeId')
            if action == 'play-next':
                position = 0
            elif before is None:
                position = len(rest)
            else:
                position = next((index for index, item in enumerate(rest) if item['id'] == before), None)
                if position is None:
                    raise ApiError(409, 'The queue changed. Choose the position again.')
            return api.request('PATCH', path, {'position': position})

    def artwork(self, path=None):
        with self.lock:
            path = path or ((self.playback or {}).get('currentTrack') or {}).get('artworkUrl')
            if not path or not isinstance(path, str) or not path.startswith('/v2/artwork/') or len(path) > 4096 or '?' in path or '#' in path:
                raise ApiError(404, 'No artwork')
            if path in self.artworks:
                self.artworks.move_to_end(path)
                return self.artworks[path]
            epoch = self.epoch
        with self.artwork_slots:
            api = self.api_for()
            connection, response = api.open('GET', path)
            try:
                data = response.read(2 * 1024 * 1024 + 1)
                mime = response.getheader('Content-Type', '').split(';')[0]
                if len(data) > 2 * 1024 * 1024 or mime not in ('image/png', 'image/jpeg', 'image/webp'):
                    raise ValueError('Invalid thumbnail')
            finally:
                connection.close()
        with self.lock:
            if epoch == self.epoch:
                self.artworks[path] = (mime, data)
                while len(self.artworks) > 20 or sum(len(entry[1]) for entry in self.artworks.values()) > 8 * 1024 * 1024:
                    self.artworks.popitem(last=False)
        return mime, data

    def start_discovery(self):
        with self.lock:
            self.pair_generation += 1
            generation = self.pair_generation
            self.pairing = {'state': 'discovering'}
        def run():
            try:
                hosts = discover()
                with self.lock:
                    if generation == self.pair_generation:
                        self.hosts = hosts
                        self.pairing = {'state': 'choose' if hosts else 'not-found',
                                        'hosts': [{'id': host['id'], 'name': host['name']} for host in hosts]}
            except Exception:
                with self.lock:
                    if generation == self.pair_generation:
                        self.pairing = {'state': 'not-found'}
        threading.Thread(target=run, daemon=True).start()

    def cancel_pairing(self):
        with self.lock:
            self.pair_generation += 1
            self.pairing = {'state': 'idle'}

    def start_pairing(self, host_id):
        with self.lock:
            candidate = next((host for host in self.hosts if host['id'] == host_id), None)
            if not candidate:
                raise ValueError('Choose a discovered computer')
            self.pair_generation += 1
            generation = self.pair_generation
            self.pairing = {'state': 'connecting', 'host': candidate['name']}
        def update(value):
            with self.lock:
                if generation == self.pair_generation:
                    self.pairing = value
                    return True
            return False
        def run():
            ephemeral = None
            try:
                pin = inspect_certificate(candidate['base_url'])
                api = Api({'base_url': candidate['base_url'], 'fingerprint': pin})
                ephemeral = EphemeralKey()
                response = api.request('POST', '/v1/pairing/hardware-request', {
                    'deviceName': 'Astra Thing', 'clientLabel': 'Astra Thing',
                    'phoneEphemeralPublicKey': ephemeral.public, 'observedCertificateFingerprint': pin,
                    'requestedScopes': SCOPES, 'deviceInfo': DEVICE_INFO})
                key, transcript, code, proof = derive_pairing(ephemeral, response, pin, candidate)
                # Relative deadline: the Thing's wall clock is not trusted.
                deadline = time.monotonic() + 115
                if not update({'state': 'approval', 'host': candidate['name'], 'code': code}):
                    return
                while time.monotonic() < deadline:
                    with self.lock:
                        if generation != self.pair_generation:
                            return
                    status = api.request('GET', '/v1/pairing/status?' + urlencode({'pollToken': response['pollToken']}))
                    if status['state'] == 'approved':
                        sealed = api.request('POST', '/v1/pairing/hardware-confirm', {'requestId': response['requestId'], 'proof': proof})
                        credentials = decrypt_credentials(key, transcript, sealed['sealed'])
                        if (fingerprint(credentials['certificateFingerprint']) != pin
                                or credentials['identity']['endpointUuid'] != candidate['id']
                                or set(credentials['scopes']) != {'control', *SCOPES}
                                or credentials.get('syncToken') is not None
                                or not isinstance(credentials.get('controlToken'), str)
                                or len(credentials['controlToken']) < 32):
                            raise ValueError('Unexpected pairing credentials')
                        config = {'base_url': candidate['base_url'], 'fingerprint': pin,
                                  'token': credentials['controlToken'], 'device_id': credentials['deviceId'],
                                  'scopes': credentials['scopes'], 'endpoint_uuid': candidate['id'],
                                  'desktop_name': credentials['identity']['desktopName'], 'profile': 'hardware-v1'}
                        with self.lock:
                            if generation != self.pair_generation:
                                return
                            save_connection(self.path, config)
                            self.config = config
                            self.interrupt_observer()
                            self.pairing = {'state': 'approved', 'host': config['desktop_name']}
                        return
                    if status['state'] != 'pending':
                        update({'state': 'declined' if status['state'] == 'rejected' else 'expired'})
                        return
                    time.sleep(1)
                update({'state': 'expired'})
            except Exception as error:
                update({'state': 'expired' if isinstance(error, ApiError) and error.status == 410 else 'error',
                        'message': 'Pairing could not finish. Try again in a moment.'})
                print('Pairing unavailable:', type(error).__name__, flush=True)
            finally:
                if ephemeral:
                    ephemeral.close()
        threading.Thread(target=run, daemon=True).start()

    def device_action(self, body):
        action = body.get('action')
        if action not in ('forget', 'factory-reset', 'restart') or body.get('confirmation') != action:
            raise ValueError('Confirm the device action')
        if action == 'restart':
            if not BACKLIGHT.exists():
                raise ApiError(503, 'Restart is only available on the Thing')
            threading.Timer(0.5, lambda: subprocess.run(['systemctl', 'reboot'], check=False)).start()
            return {'accepted': True}
        with self.lock:
            self.cancel_pairing()
            self.path.unlink(missing_ok=True)
            self.config = None
            self.playback = None
            self.interrupt_observer()
            if action == 'factory-reset':
                self.preferences = dict(DEFAULTS)
                save_connection(self.preferences_path, self.preferences)
                self.dimmed = False
                self.apply_brightness()
        return {'accepted': True}
