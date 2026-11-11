import os
import sys
import time
import json
import socket
import base64
import urllib.request
import subprocess
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
import websocket

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def find_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

class CDPClient:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=15)
        self.msg_id = 0

    def send(self, method, params=None):
        self.msg_id += 1
        req_id = self.msg_id
        payload = {"id": req_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        start_t = time.time()
        while time.time() - start_t < 15:
            try:
                raw = self.ws.recv()
                data = json.loads(raw)
                if data.get("id") == req_id:
                    return data.get("result", {})
            except websocket.WebSocketTimeoutException:
                pass
        raise TimeoutError(f"CDP call {method} timed out")

    def evaluate(self, expression):
        res = self.send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        if "exceptionDetails" in res:
            raise RuntimeError(f"JS Exception: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")

    def capture_screenshot(self, filepath):
        res = self.send("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        with open(filepath, "wb") as f:
            f.write(data)
        print(f"  [Screenshot] Saved: {filepath}")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

def main():
    os.chdir(PROJECT_DIR)
    http_port = find_free_port()
    cdp_port = find_free_port()

    class QuietHandler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            super().end_headers()
        def log_message(self, format, *args):
            pass

    server = HTTPServer(('127.0.0.1', http_port), QuietHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"[HTTP] Server running on port {http_port}")

    chrome_cmd = [
        CHROME_PATH,
        "--headless=new",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
        "--window-size=1400,1050",
        "--disable-gpu",
        "--no-sandbox",
        "--user-data-dir=" + os.path.join(PROJECT_DIR, ".chrome_wheel_profile"),
        f"http://127.0.0.1:{http_port}/index.html"
    ]
    proc = subprocess.Popen(chrome_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ws_url = None
    for attempt in range(25):
        time.sleep(0.4)
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json") as r:
                pages = json.loads(r.read().decode())
                for p in pages:
                    if p.get("type") == "page" and "webSocketDebuggerUrl" in p:
                        ws_url = p["webSocketDebuggerUrl"]
                        break
            if ws_url:
                break
        except Exception:
            pass

    if not ws_url:
        proc.terminate()
        server.shutdown()
        raise RuntimeError("Failed to connect to CDP")

    try:
        cdp = CDPClient(ws_url)
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        time.sleep(1.0)

        # 1. Setup sample diary data on item 1 and open wheel modal
        cdp.evaluate("""
            (function() {
                const keys = Object.keys(window.__crimsonTierState.items);
                if (keys.length > 0) {
                    const it = window.__crimsonTierState.items[keys[0]];
                    it.startDate = '2024-01-10';
                    it.endDate = '2024-02-05';
                    it.rewatchDates = [
                        { startDate: '2024-04-12', endDate: '2024-05-02', comment: 'Весенний пересмотр шедевра!' },
                        { startDate: '2024-07-15', endDate: '2024-08-01', comment: 'Летний марафон' },
                        { startDate: '2024-10-05', endDate: '2024-10-25', comment: 'Осенняя ностальгия' }
                    ];
                    window.__crimsonTierApp.openYearWheelModal(keys[0]);
                }
            })()
        """)
        time.sleep(1.0)

        # 2. Check modal is open
        is_open = cdp.evaluate("document.getElementById('modal-year-wheel').style.display !== 'none'")
        print(f"Modal year wheel is open: {is_open}")
        assert is_open, "Modal year wheel should be open"

        # 3. Verify single bold ring with 12 months colored by season
        month_cells_count = cdp.evaluate("document.querySelectorAll('.wheel-month-cell').length")
        print(f"Month cells count: {month_cells_count}")
        assert month_cells_count == 12, "Should have 12 month cells"

        month_text_colors = cdp.evaluate("""
            Array.from(document.querySelectorAll('.wheel-months-group text')).map(t => t.getAttribute('fill'))
        """)
        print(f"Month text colors: {month_text_colors}")
        assert '#38bdf8' in month_text_colors, "Winter color should be present"
        assert '#4ade80' in month_text_colors, "Spring color should be present"
        assert '#facc15' in month_text_colors, "Summer color should be present"
        assert '#f97316' in month_text_colors, "Autumn color should be present"

        # 4. Verify season watermarks
        watermarks = cdp.evaluate("""
            Array.from(document.querySelectorAll('.wheel-season-watermark')).map(t => t.textContent)
        """)
        print(f"Watermarks: {watermarks}")
        assert set(watermarks) == {'ЗИМА', 'ВЕСНА', 'ЛЕТО', 'ОСЕНЬ'}, "All 4 seasons watermarked"

        # 5. Verify sector beams count
        sector_groups_count = cdp.evaluate("document.querySelectorAll('.wheel-sector-group').length")
        print(f"Sector groups count: {sector_groups_count}")
        assert sector_groups_count == 4, "Should have 4 sector groups (primary + 3 rewatches)"

        # 6. Test TOGGLE switch!
        # Check initial state: all 4 are visible
        hidden_before = cdp.evaluate("document.querySelectorAll('.wheel-sector-group.is-hidden').length")
        print(f"Hidden before toggle: {hidden_before}")
        assert hidden_before == 0, "No sectors should be hidden initially"

        # Click the toggle on the second layer (rewatch-0)
        cdp.evaluate("""
            (function() {
                const secondToggle = document.querySelectorAll('.wheel-layer-row')[1].querySelector('input[type="checkbox"]');
                secondToggle.click();
            })()
        """)
        time.sleep(0.5)

        hidden_after = cdp.evaluate("document.querySelectorAll('.wheel-sector-group.is-hidden').length")
        second_sector_display = cdp.evaluate("document.querySelectorAll('.wheel-sector-group')[1].style.display")
        print(f"Hidden after toggle: {hidden_after}, second sector display: '{second_sector_display}'")
        assert hidden_after == 1, "Exactly 1 sector should now be hidden"
        assert second_sector_display == 'none', "Second sector display should be 'none'"

        # Click toggle again to restore
        cdp.evaluate("""
            (function() {
                const secondToggle = document.querySelectorAll('.wheel-layer-row')[1].querySelector('input[type="checkbox"]');
                secondToggle.click();
            })()
        """)
        time.sleep(0.5)
        hidden_restored = cdp.evaluate("document.querySelectorAll('.wheel-sector-group.is-hidden').length")
        print(f"Hidden after re-toggle: {hidden_restored}")
        assert hidden_restored == 0, "All sectors visible again"

        # 7. Take screenshot of the new single bold ring & seasonal styling
        artifact_path = r"C:\Users\user\.gemini\antigravity\brain\8da16984-0e15-4959-9eee-43eaf781c214\screenshot_year_wheel.png"
        cdp.capture_screenshot(artifact_path)
        print("ALL TESTS PASSED SUCCESSFULLY!")

        cdp.close()
    finally:
        proc.kill()
        server.shutdown()

if __name__ == "__main__":
    main()
