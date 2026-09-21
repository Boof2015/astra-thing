"""Root-only connection between the local display and maintenance service."""
# SPDX-License-Identifier: GPL-3.0-only
import json
import socket
from http.client import HTTPConnection

SOCKET = '/run/astra-thing-management.sock'

class LocalConnection(HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)

def request(action, body=None):
    connection = LocalConnection('localhost', timeout=.4)
    try:
        payload = json.dumps(body or {})
        connection.request('POST', '/' + action, payload, {'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read(8193)
        if response.status != 200 or len(data) > 8192:
            raise OSError('Management service unavailable')
        return json.loads(data)
    finally:
        connection.close()
