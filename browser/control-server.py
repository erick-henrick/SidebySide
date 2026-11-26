import hmac
import json
import os
from pathlib import Path
import re
import time
import subprocess
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("CONTROL_TOKEN", "")
if len(TOKEN) < 24:
    raise RuntimeError("Configure CONTROL_TOKEN with at least 24 characters")

METHODS = {"Runtime.evaluate", "Page.bringToFront", "Page.navigate", "Page.getFrameTree",
           "Input.dispatchKeyEvent", "Input.dispatchMouseEvent"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/live/"):
            return self.live()
        if self.path != "/health":
            return self.reply(404, {"error": "Not found"})
        try:
            with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=2) as response:
                pages = json.load(response)
            with urllib.request.urlopen("http://127.0.0.1:8080/", timeout=2):
                pass
            if not any(page.get("type") == "page" for page in pages):
                raise RuntimeError("Waiting for browser")
            self.reply(200, {"status": "ok"})
        except Exception:
            self.reply(503, {"status": "starting"})

    def live(self):
        name = self.path.removeprefix("/live/")
        if not re.fullmatch(r"live\.m3u8|chunk-\d+\.ts", name):
            return self.reply(404, {"error": "Not found"})
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.reply(401, {"error": "Unauthorized"})

        path = Path("/tmp/cinema-hls") / name
        try:
            if name == "live.m3u8" and time.time() - path.stat().st_mtime > 8:
                return self.reply(503, {"error": "Stream offline"})
            payload = path.read_bytes()
        except FileNotFoundError:
            return self.reply(404, {"error": "Not found"})

        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.apple.mpegurl" if name == "live.m3u8" else "video/mp2t")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != "/command":
            return self.reply(404, {"error": "Not found"})
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.reply(401, {"error": "Unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024 * 1024:
                return self.reply(400, {"error": "Invalid length"})
            command = json.loads(self.rfile.read(length))
            if command.get("method") not in METHODS or not isinstance(command.get("params"), dict):
                return self.reply(400, {"error": "Invalid command"})
            result = subprocess.run([sys.executable, "/opt/cinema/inspect-browser.py",
                                     command["method"], json.dumps(command["params"])],
                                    capture_output=True, text=True, timeout=22, check=True)
            self.reply(200, json.loads(result.stdout))
        except subprocess.CalledProcessError:
            self.reply(502, {"error": "O navegador remoto ainda não está disponível."})
        except subprocess.TimeoutExpired:
            self.reply(504, {"error": "O navegador remoto demorou para responder."})
        except (ValueError, KeyError, TypeError):
            self.reply(400, {"error": "Invalid request"})


ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
