import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'prototype'))
from client import ApiError
from device_client import DeviceClient
from hardware_pairing import EphemeralKey, DEVICE_INFO, SCOPES, b64, unb64, derive_pairing, decrypt_credentials, parse_discovery


class DeviceTests(unittest.TestCase):
    def test_real_openssl_pairing_matches_independent_node_peer_and_rejects_tampering(self):
        ephemeral = EphemeralKey()
        directory = ephemeral.directory.name
        try:
            peer = json.loads(subprocess.run(['node', str(Path(__file__).with_name('pairing-peer.mjs'))],
                input=json.dumps({'publicKey': ephemeral.public}),text=True,capture_output=True,check=True).stdout)
            candidate = {'id': 'desktop-test', 'base_url': 'https://10.42.1.238:38402'}
            key, transcript, code, proof = derive_pairing(ephemeral, peer['response'], 'ab' * 32, candidate)
            self.assertEqual((code, proof), (peer['code'], peer['proof']))
            self.assertEqual(decrypt_credentials(key, transcript, peer['sealed'])['deviceId'], 'fixture')
            for field in ['authTag', 'ciphertext', 'nonce']:
                tampered = dict(peer['sealed'])
                raw = bytearray(unb64(tampered[field]));raw[0] ^= 1;tampered[field] = b64(raw)
                with self.assertRaises(ValueError):
                    decrypt_credentials(key, transcript, tampered)
            with self.assertRaises(ValueError):
                decrypt_credentials(key, transcript + b'changed', peer['sealed'])
            for override in [{'certificateFingerprint': '00' * 32}, {'protocolVersion': 2},
                             {'identity': {'endpointUuid': 'other'}},
                             {'hardware': {**peer['response']['hardware'], 'requestedScopes': SCOPES + ['library-write']}}]:
                with self.assertRaises(ValueError):
                    derive_pairing(ephemeral, {**peer['response'], **override}, 'ab' * 32, candidate)
        finally:
            ephemeral.close()
        self.assertFalse(Path(directory).exists())

    def test_device_metadata_is_bound_to_pairing_code_and_ciphertext(self):
        ephemeral = EphemeralKey()
        try:
            peer = json.loads(subprocess.run(['node', str(Path(__file__).with_name('pairing-peer.mjs'))],
                input=json.dumps({'publicKey': ephemeral.public, 'deviceInfo': DEVICE_INFO}), text=True, capture_output=True, check=True).stdout)
            candidate = {'id': 'desktop-test', 'base_url': 'https://10.42.1.238:38402'}
            key, transcript, code, proof = derive_pairing(ephemeral, peer['response'], 'ab' * 32, candidate)
            self.assertEqual((code, proof), (peer['code'], peer['proof']))
            self.assertEqual(decrypt_credentials(key, transcript, peer['sealed'])['deviceId'], 'fixture')
            peer['response']['hardware']['deviceInfo']['modelId'] = 'different-model'
            with self.assertRaises(ValueError):
                derive_pairing(ephemeral, peer['response'], 'ab' * 32, candidate)
        finally:
            ephemeral.close()

    def test_discovery_filters_profiles_and_deduplicates_preferring_usb(self):
        txt='"transport=https" "endpoint_uuid=desktop-test" "hardware_pairing=hardware-v1" "name=Studio\\032Mac"'
        output=f'=;wlan0;IPv4;Studio;_astra-remote._tcp;local;studio.local;192.168.1.2;38402;{txt}\n'
        output+=f'=;usb0;IPv4;Studio;_astra-remote._tcp;local;studio.local;10.42.1.238;38402;{txt}\n'
        output+=f'=;usb0;IPv4;Bad;_astra-remote._tcp;local;bad.local;127.0.0.1;38402;{txt}\n'
        self.assertEqual(parse_discovery(output), [{'id':'desktop-test','name':'Studio Mac','base_url':'https://10.42.1.238:38402'}])
        self.assertEqual(parse_discovery(output.replace('hardware-v1','unknown')), [])

    def test_queue_identity_and_moves_use_current_neighbor_not_stale_index(self):
        with tempfile.TemporaryDirectory() as root:
            client = DeviceClient(Path(root) / 'connection.json')
            client.connected = True;client.scopes = list(SCOPES);client.api = Mock()
            client.queue = [{'id': name, 'track': {'ref': 'same-song'}} for name in ['new', 'a', 'b', 'c']]
            client.music_action({'action':'move','id':'b','beforeId':'a'})
            client.api.request.assert_called_with('PATCH', '/v2/queue/items/b', {'position': 1})
            client.music_action({'action':'play-next','id':'b'})
            client.api.request.assert_called_with('PATCH', '/v2/queue/items/b', {'position': 0})
            client.music_action({'action':'remove','id':'a'})
            client.api.request.assert_called_with('DELETE', '/v2/queue/items/a')
            for body in [{'action':'move','id':'b','beforeId':'gone'}, {'action':'remove','id':'gone'}]:
                with self.assertRaises(ApiError):client.music_action(body)
            client.connected = False
            with self.assertRaises(ApiError):client.music_action({'action':'remove','id':'b'})

    def test_preferences_private_persistent_and_forget_preserves_appearance(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / 'connection.json'
            client = DeviceClient(state)
            client.set_preferences({'surface':'dark','brightness':60,'idle':30})
            self.assertEqual(client.preferences_path.stat().st_mode & 0o777, 0o600)
            other = DeviceClient(state)
            self.assertEqual(other.preferences['brightness'],60)
            for bad in [{'brightness':True},{'brightness':0},{'idle':15},{'surface':'neon'},{'token':'bad'}]:
                with self.assertRaises(ValueError):client.set_preferences(bad)
            client.config={'token':'private-fixture','fingerprint':'ab'*32,'desktop_name':'Astra test'}
            self.assertNotIn('private-fixture', json.dumps(client.snapshot()))
            with self.assertRaises(ValueError):client.device_action({'action':'factory-reset'})
            client.device_action({'action':'forget','confirmation':'forget'})
            self.assertEqual(client.preferences['surface'],'dark')
            client.device_action({'action':'factory-reset','confirmation':'factory-reset'})
            self.assertEqual(client.preferences['surface'],'light')
            self.assertIsNone(client.config)

    def test_dimming_consumes_first_hardware_gesture(self):
        with tempfile.TemporaryDirectory() as root:
            client=DeviceClient(Path(root)/'connection.json');client.dimmed=True
            client.input_event('rotary',2,6,1)
            self.assertFalse(client.dimmed);self.assertEqual(client.input_events,[])
            client.input_event('rotary',2,6,1)
            self.assertEqual(client.input_events[-1][2],{'type':'dial','delta':1})

    def test_browsing_limits_and_allowlisted_intents(self):
        with tempfile.TemporaryDirectory() as root:
            client=DeviceClient(Path(root)/'connection.json');client.connected=True;client.api=Mock();client.scopes=list(SCOPES)
            client.features={'playlistListing':True}
            client.playlist_page('astra.playlist.cursor')
            client.api.request.assert_called_with('GET','/v2/playlists?limit=3&cursor=astra.playlist.cursor')
            client.search('a & b')
            client.api.request.assert_called_with('GET','/v2/search?q=a+%26+b&types=track&limit=50')
            for body in [{'action':'create-playlist'}, {'action':'play','ref':'file:///private/music'}, {'action':'enqueue','ref':'astra.track.a','position':'anywhere'}]:
                with self.assertRaises(ValueError):client.music_action(body)
            client.scopes=['observe']
            with self.assertRaises(ApiError):client.search('test')
            with self.assertRaises(ApiError):client.playlist_page()

if __name__ == '__main__':
    unittest.main()
