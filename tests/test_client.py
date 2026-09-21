import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'prototype'))
from client import Api, ApiError, Client, handler, playback_events, save_connection


class ClientTests(unittest.TestCase):
    def test_wrong_certificate_receives_no_credential_or_http_request(self):
        received = []
        class Handler(BaseHTTPRequestHandler):
            def handle(self):
                try:
                    super().handle()
                except ConnectionResetError:
                    pass  # Expected when a peer rejects our certificate pin.
            def do_GET(self):
                received.append(self.headers.get('Authorization'))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            def log_message(self, *_):
                pass
        with tempfile.TemporaryDirectory() as temporary:
            certificate, key = Path(temporary) / 'cert.pem', Path(temporary) / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-keyout', str(key), '-out', str(certificate), '-days', '1',
                            '-subj', '/CN=astra-test'], check=True, capture_output=True)
            digest = hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate.read_text())).hexdigest()
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certificate, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                config = {'base_url': f'https://127.0.0.1:{server.server_port}', 'token': 'test-only-token', 'fingerprint': '0' * 64}
                with self.assertRaises(ssl.SSLError):
                    Api(config).request('GET', '/v2/playback')
                self.assertEqual(received, [])
                config['fingerprint'] = digest
                self.assertEqual(Api(config).request('GET', '/v2/playback'), {'ok': True})
                self.assertEqual(received, ['Bearer test-only-token'])
            finally:
                server.shutdown()
                server.server_close()

    def test_sse_multiline_heartbeat_and_disconnect(self):
        stream = io.BytesIO(b': heartbeat\r\n\r\nevent: playback\r\ndata: {"state":\r\ndata: "paused"}\r\n\r\n')
        self.assertEqual(list(playback_events(stream)), [('playback', {'state': 'paused'})])

    def test_disconnected_controls_do_not_replay_later(self):
        client = Client(Path('/unused'))
        client.api = Mock()
        with self.assertRaises(ApiError):
            client.command({'action': 'next'})
        client.api.request.assert_not_called()
        client.connected, client.scopes = True, ['observe', 'playback-control']
        client.playback = {'state': 'playing', 'volume': .5}
        client.command({'action': 'toggle'})
        client.api.request.assert_called_once_with('POST', '/v2/playback/actions', {'action': 'pause'})
        for volume in (float('nan'), -1, 1.1, True):
            with self.assertRaises(ValueError):
                client.command({'action': 'set-volume', 'volume': volume})
        self.assertEqual(client.api.request.call_count, 1)

    def test_saved_pairing_is_private_and_replaced_atomically(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'connection.json'
            save_connection(path, {'token': 'first'})
            save_connection(path, {'token': 'second'})
            self.assertEqual(json.loads(path.read_text()), {'token': 'second'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_suffix('.new').exists())

    def test_player_actions_validate_values_and_bind_seek_to_current_track(self):
        client = Client(Path('/unused'))
        client.api = Mock()
        client.connected, client.scopes = True, ['playback-control']
        client.playback = {'currentTrack': {'ref': 'track-a'}, 'durationSeconds': 240}
        client.command({'action': 'seek', 'positionSeconds': 300, 'trackRef': 'track-a'})
        client.api.request.assert_called_with('POST', '/v2/playback/actions', {'action': 'seek', 'positionSeconds': 240})
        with self.assertRaises(ApiError) as error:
            client.command({'action': 'seek', 'positionSeconds': 10, 'trackRef': 'track-b'})
        self.assertEqual(error.exception.status, 409)
        for value in (-1, True, float('nan'), '12'):
            with self.assertRaises(ValueError):
                client.command({'action': 'seek', 'positionSeconds': value, 'trackRef': 'track-a'})
        for action in ({'action':'set-shuffle','enabled':'false'}, {'action':'set-repeat','mode':'invalid'}):
            with self.assertRaises(ValueError):
                client.command(action)
        self.assertEqual(client.api.request.call_count, 1)
        for action in ({'action':'set-shuffle','enabled':True}, {'action':'set-repeat','mode':'one'}, {'action':'set-repeat','mode':'all'}, {'action':'set-repeat','mode':'none'}):
            client.command(action)
            client.api.request.assert_called_with('POST', '/v2/playback/actions', action)

    def test_input_mapping_has_one_owner_and_ignores_release_and_autorepeat(self):
        client = Client(Path('/unused'))
        client.command = Mock()
        for value in (1, 2, 0):
            client.input_event('gpio-keys-polled', 1, 28, value)
        client.input_event('gpio-keys-polled', 1, 50, 1)
        client.input_event('rotary', 2, 6, -2)
        self.assertEqual([entry[2] for entry in client.input_events], [
            {'type':'key','key':'press'}, {'type':'key','key':'settings'}, {'type':'dial','delta':-2}])
        client.command.assert_not_called()
        for _ in range(100):
            client.input_event('rotary', 2, 6, 1)
        self.assertEqual(len(client.input_events), 64)
        self.assertEqual(client.input_sequence, 103)

    def test_input_stream_starts_at_tail_and_does_not_replay_an_old_press(self):
        client = Client(Path('/unused'))
        client.input_event('gpio-keys-polled', 1, 28, 1)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(client))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=4)
        try:
            connection.request('GET', '/input-events', headers={'Host':'127.0.0.1:8080', 'Last-Event-ID':'0'})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual([response.readline() for _ in range(3)], [b'event: ready\n', b'data: {}\n', b'\n'])
            client.input_event('gpio-keys-polled', 1, 50, 1)
            self.assertEqual(response.readline(), b'id: 2\n')
            self.assertEqual(response.readline(), b'event: input\n')
            self.assertEqual(json.loads(response.readline().decode()[6:]), {'type':'key','key':'settings'})
            response.close()
        finally:
            connection.close();server.shutdown();server.server_close()


if __name__ == '__main__':
    unittest.main()
