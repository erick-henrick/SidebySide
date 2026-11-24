import base64
import hashlib
import json
import os
import socket
import struct
import sys
import urllib.request
from urllib.parse import urlparse


def receive_exact(connection, length):
    data = bytearray()
    while len(data) < length:
        chunk = connection.recv(length - len(data))
        if not chunk:
            raise RuntimeError("Browser connection closed")
        data.extend(chunk)
    return bytes(data)


def send_frame(connection, payload, opcode=1):
    mask = os.urandom(4)
    length = len(payload)
    header = bytes([0x80 | opcode])
    if length < 126:
        header += bytes([0x80 | length])
    elif length < 65536:
        header += bytes([0xFE]) + struct.pack("!H", length)
    else:
        header += bytes([0xFF]) + struct.pack("!Q", length)
    masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    connection.sendall(header + mask + masked)


with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5) as response:
    pages = json.load(response)
tabs = [page for page in pages if page["type"] == "page"]
target_file = "/tmp/side-by-side-player-target"
try:
    with open(target_file) as saved:
        target_id = saved.read().strip()
except FileNotFoundError:
    target_id = ""
page = next((tab for tab in tabs if tab["id"] == target_id), None)
if page is None:
    page = next((tab for tab in tabs if urlparse(tab["url"]).hostname in {
        "youtube.com", "www.youtube.com", "m.youtube.com"
    }), None)
if page is None:
    page = next((tab for tab in tabs if not tab["url"].startswith("chrome-extension://")), None)
if page is None:
    raise RuntimeError("Player tab unavailable")
with open(target_file, "w") as saved:
    saved.write(page["id"])
endpoint = urlparse(page["webSocketDebuggerUrl"])
with socket.create_connection((endpoint.hostname, endpoint.port), timeout=10) as connection:
    nonce = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET {endpoint.path} HTTP/1.1\r\n"
        f"Host: {endpoint.hostname}:{endpoint.port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {nonce}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    connection.sendall(handshake.encode())
    headers = bytearray()
    while not headers.endswith(b"\r\n\r\n"):
        headers.extend(receive_exact(connection, 1))
    expected_accept = base64.b64encode(hashlib.sha1(
        (nonce + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()
    ).digest())
    if b" 101 " not in headers or expected_accept not in headers:
        raise RuntimeError("Browser handshake failed")
    command = {"id": 1, "method": sys.argv[1], "params": json.loads(sys.argv[2])}
    send_frame(connection, json.dumps(command).encode())
    while True:
        first, second = receive_exact(connection, 2)
        opcode = first & 15
        length = second & 127
        if length == 126:
            length = struct.unpack("!H", receive_exact(connection, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", receive_exact(connection, 8))[0]
        payload = receive_exact(connection, length)
        if opcode == 9:
            send_frame(connection, payload, 10)
            continue
        if opcode == 8:
            raise RuntimeError("Browser closed inspector")
        if opcode != 1:
            continue
        message = json.loads(payload)
        if message.get("id") == 1:
            if "error" in message:
                raise RuntimeError(str(message["error"]))
            print(json.dumps(message["result"]))
            break
