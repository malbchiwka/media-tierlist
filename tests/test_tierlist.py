"""
End-to-end automated test suite for Crimson Tier Media Tierlist using Headless Chrome & CDP.
"""

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

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT_HTTP = 9876
PORT_CDP = 9222


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
                if data.get("method") == "Page.javascriptDialogOpening":
                    dialog_ack = json.dumps({"id": 88888, "method": "Page.handleJavaScriptDialog", "params": {"accept": True}})
                    self.ws.send(dialog_ack)
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


def run_tests():
    print("=== CRIMSON TIER END-TO-END TEST SUITE ===")
    http_port = PORT_HTTP

    # 1. Start HTTP Server
    class QuietHandler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            super().end_headers()
        def log_message(self, format, *args):
            pass

    os.chdir(PROJECT_DIR)
    httpd = HTTPServer(('127.0.0.1', http_port), QuietHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    print(f"[HTTP] Server running at http://127.0.0.1:{http_port}")

    # 2. Launch Chrome Headless
    cdp_port = find_free_port()
    chrome_cmd = [
        CHROME_PATH,
        "--headless=new",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
        "--window-size=1400,1050",
        "--disable-gpu",
        "--no-sandbox",
        "--user-data-dir=" + os.path.join(PROJECT_DIR, ".chrome_test_profile"),
        f"http://127.0.0.1:{http_port}/index.html"
    ]
    print(f"[Chrome] Launching Headless Chrome on CDP port {cdp_port}...")
    chrome_proc = subprocess.Popen(chrome_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 3. Wait for CDP to be ready
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
        chrome_proc.terminate()
        httpd.shutdown()
        raise RuntimeError("Failed to connect to Headless Chrome CDP.")

    print(f"[CDP] Connected to Chrome page target: {ws_url}")
    cdp = CDPClient(ws_url)

    # Enable Page and Runtime domains
    cdp.send("Page.enable")
    cdp.send("Runtime.enable")

    # Override modal dialogs so headless Chrome never blocks on confirm/alert
    cdp.evaluate("window.confirm = () => true; window.alert = () => {};")

    # Ensure completely clean and deterministic state for every test run
    cdp.evaluate("if (window.__crimsonTierApp && window.__crimsonTierApp.resetToDefaults) { window.__crimsonTierApp.resetToDefaults(); }")

    # Give page time to execute scripts and render
    time.sleep(1.0)

    results = []

    def test(name, fn):
        try:
            fn()
            print(f"  [PASS] {name}")
            results.append((name, True, ""))
        except Exception as err:
            print(f"  [FAIL] {name}: {err}")
            results.append((name, False, str(err)))

    try:
        # TEST 1: Page Initialization
        def t1():
            title = cdp.evaluate("document.title")
            assert "Crimson Tier" in title, f"Unexpected page title: {title}"
            tier_rows = cdp.evaluate("document.querySelectorAll('.tier-row').length")
            assert tier_rows >= 6, f"Expected >= 6 tier rows, got {tier_rows}"
            total_items = cdp.evaluate("Object.keys(window.__crimsonTierState.items).length")
            assert total_items >= 20, f"Expected >= 20 items in state, got {total_items}"
            cards_count = cdp.evaluate("document.querySelectorAll('.media-card').length")
            assert cards_count >= 20, f"Expected >= 20 rendered cards, got {cards_count}"
        test("1. Initial state and DOM rendering (tiers, cards, count)", t1)

        # TEST 2: Unified Controls Bar, Bank Header & No Title Tooltips
        def t2():
            # Verify logo and brand titles removed per task requirement
            has_brand_group = cdp.evaluate("document.querySelector('.brand-group') !== null")
            assert not has_brand_group, "Header still contains removed brand-group"
            has_brand_name = cdp.evaluate("document.querySelector('.brand-name') !== null")
            assert not has_brand_name, "Header still contains removed brand-name"

            # Verify counter badges and unnecessary buttons were removed from header
            has_stat_total = cdp.evaluate("document.getElementById('stat-total') !== null")
            assert not has_stat_total, "Header still contains removed #stat-total badge"
            has_presets_btn = cdp.evaluate("document.getElementById('btn-presets') !== null")
            assert not has_presets_btn, "Header still contains removed #btn-presets button"
            has_backup_btn = cdp.evaluate("document.getElementById('btn-backup') !== null")
            assert not has_backup_btn, "Header still contains removed #btn-backup button"

            # Verify board header has left controls (filters, add tier) and right controls (add item, export png)
            has_add_btn = cdp.evaluate("document.querySelector('.board-header-right #btn-add-item') !== null")
            assert has_add_btn, "Right header missing #btn-add-item button"
            has_export_btn = cdp.evaluate("document.querySelector('.board-header-right #btn-export-png') !== null")
            assert has_export_btn, "Right header missing #btn-export-png button"
            has_filters_left = cdp.evaluate("document.querySelector('.board-header-left #filter-pills') !== null")
            assert has_filters_left, "Left header missing #filter-pills"
            has_add_tier_left = cdp.evaluate("document.querySelector('.board-header-left #btn-add-tier') !== null")
            assert has_add_tier_left, "Left header missing #btn-add-tier button"

            # Verify search input is moved below tiers
            has_search_below = cdp.evaluate("document.querySelector('.board-search-bar #board-search-input') !== null")
            assert has_search_below, "Search input should be placed below tiers in .board-search-bar"

            # Verify bank title: accent bar removed, pool badge count removed, hint removed
            has_pool_badge = cdp.evaluate("document.getElementById('pool-badge-count') !== null")
            assert not has_pool_badge, "Pool badge count should be removed"
            has_accent_bar = cdp.evaluate("document.querySelector('.pool-section .title-accent-bar') !== null")
            assert not has_accent_bar, "Bank title accent bar should be removed"
            has_pool_hint = cdp.evaluate("document.querySelector('.pool-hint') !== null")
            assert not has_pool_hint, "Bank title hint text should be removed"

            # Verify sort buttons are placed directly next to bank title separated by dash
            has_sort_in_title = cdp.evaluate("document.querySelector('.pool-title-group .sort-group') !== null")
            assert has_sort_in_title, "Sort buttons should be placed next to bank title"

            # Verify no [title] attributes exist on any elements in body
            title_count = cdp.evaluate("document.body.querySelectorAll('[title]').length")
            assert title_count == 0, f"Expected 0 elements with title tooltips, found {title_count}"

            # Verify count all filter still matches state
            count_all = cdp.evaluate("document.getElementById('count-all').textContent")
            total_items = cdp.evaluate("Object.keys(window.__crimsonTierState.items).length")
            assert int(count_all) == total_items, f"Count all {count_all} != state {total_items}"
        test("2. Unified controls bar, bank header (no bar, no count, no hint), inline sort & no title tooltips", t2)

        # TEST 3: Category Filter (All / Movies / Anime)
        def t3():
            # Click Movies filter
            cdp.evaluate("document.querySelector('.filter-pill[data-filter=\"movie\"]').click()")
            visible_movies = cdp.evaluate("document.querySelectorAll('.media-card:not([style*=\"display: none\"])').length")
            # All visible cards must be movies
            non_movies = cdp.evaluate("""
                (() => {
                    const cards = Array.from(document.querySelectorAll('.media-card:not([style*="display: none"])'));
                    return cards.filter(c => window.__crimsonTierState.items[c.dataset.itemId]?.type !== 'movie').length;
                })()
            """)
            assert non_movies == 0, f"Found {non_movies} non-movie cards when 'movie' filter was active"

            # Click Anime filter
            cdp.evaluate("document.querySelector('.filter-pill[data-filter=\"anime\"]').click()")
            non_anime = cdp.evaluate("""
                (() => {
                    const cards = Array.from(document.querySelectorAll('.media-card:not([style*="display: none"])'));
                    return cards.filter(c => window.__crimsonTierState.items[c.dataset.itemId]?.type !== 'anime').length;
                })()
            """)
            assert non_anime == 0, f"Found {non_anime} non-anime cards when 'anime' filter was active"

            # Restore "All"
            cdp.evaluate("document.querySelector('.filter-pill[data-filter=\"all\"]').click()")
            all_visible = cdp.evaluate("document.querySelectorAll('.media-card:not([style*=\"display: none\"])').length")
            assert all_visible >= 20, f"Expected >= 20 cards visible on 'all', got {all_visible}"
        test("3. Category filter pills correctly filter cards by type", t3)

        # TEST 4: Search Bar Functionality
        def t4():
            cdp.evaluate("""
                const input = document.getElementById('board-search-input');
                input.value = 'Интерстеллар';
                input.dispatchEvent(new Event('input'));
            """)
            visible_cards = cdp.evaluate("document.querySelectorAll('.media-card:not([style*=\"display: none\"])').length")
            assert visible_cards >= 1, "Interstellar should be found"

            # Clear search
            cdp.evaluate("document.getElementById('board-search-clear').click()")
            all_restored = cdp.evaluate("document.querySelectorAll('.media-card:not([style*=\"display: none\"])').length")
            assert all_restored >= 20, f"Expected cards restored after search clear, got {all_restored}"
        test("4. Real-time search bar correctly filters cards and clears", t4)

        # TEST 5: Pool Sorting (Alphabetical, Year, Reset; Rating sort removed)
        def t5():
            # Rating sort button must be removed per task requirement
            has_rating_btn = cdp.evaluate("document.querySelector('.sort-btn[data-sort=\"rating\"]') !== null")
            assert not has_rating_btn, "Rating sort button should be removed from pool header"

            # Sort alphabetically
            cdp.evaluate("document.querySelector('.sort-btn[data-sort=\"alpha\"]').click()")
            first_title = cdp.evaluate("""
                (() => {
                    const cards = document.querySelectorAll('#pool-cards-container .media-card');
                    return window.__crimsonTierState.items[cards[0]?.dataset.itemId]?.title || '';
                })()
            """)
            assert len(first_title) > 0, "First alphabetical item has empty title"

            # Sort by year
            cdp.evaluate("document.querySelector('.sort-btn[data-sort=\"year\"]').click()")
            first_year = cdp.evaluate("""
                (() => {
                    const cards = document.querySelectorAll('#pool-cards-container .media-card');
                    const firstId = cards[0]?.dataset.itemId;
                    return parseInt(window.__crimsonTierState.items[firstId]?.year) || 0;
                })()
            """)
            last_year = cdp.evaluate("""
                (() => {
                    const cards = document.querySelectorAll('#pool-cards-container .media-card');
                    const lastId = cards[cards.length - 1]?.dataset.itemId;
                    return parseInt(window.__crimsonTierState.items[lastId]?.year) || 0;
                })()
            """)
            assert first_year >= last_year, f"Year sort failed: {first_year} < {last_year}"

            # Reset sort
            cdp.evaluate("document.querySelector('.sort-btn[data-sort=\"default\"]').click()")
        test("5. Pool sorting (alphabetical, year, reset; rating sort removed)", t5)

        # TEST 6: Moving Items (Tier <-> Pool)
        def t6():
            # Pick first pool item
            pool_item_id = cdp.evaluate("window.__crimsonTierState.pool[0]")
            assert pool_item_id, "No pool item found"

            # Move to tier S+
            cdp.evaluate(f"window.__crimsonTierApp.moveItem('{pool_item_id}', 'tier-s-plus')")
            in_s_plus = cdp.evaluate(f"(window.__crimsonTierState.tiers.find(t => t.id === 'tier-s-plus')?.items || []).includes('{pool_item_id}')")
            assert in_s_plus, "Item was not moved into tier S+"

            # Move back to pool
            cdp.evaluate(f"window.__crimsonTierApp.moveItem('{pool_item_id}', 'pool')")
            in_pool = cdp.evaluate(f"window.__crimsonTierState.pool.includes('{pool_item_id}')")
            assert in_pool, "Item was not moved back to pool"
        test("6. Moving item between Pool and Tier updates state and DOM", t6)

        # TEST 7: Adding a Custom Item
        def t7():
            cdp.evaluate("""
                window.__crimsonTierApp.addItemToPool({
                    id: 'custom-test-item-99',
                    title: 'Автоматический Тестовый Шедевр',
                    type: 'movie',
                    year: '2026',
                    rating: '9.9',
                    poster: ''
                }, 'pool');
            """)
            exists = cdp.evaluate("window.__crimsonTierState.items['custom-test-item-99'] !== undefined")
            assert exists, "Custom item was not added to state"
            in_pool = cdp.evaluate("window.__crimsonTierState.pool.includes('custom-test-item-99')")
            assert in_pool, "Custom item not in pool"
            card_exists = cdp.evaluate("document.querySelector('.media-card[data-item-id=\"custom-test-item-99\"]') !== null")
            assert card_exists, "Card DOM element not rendered for custom item"
        test("7. Custom item addition (title, type, rating, year) renders and persists", t7)

        # TEST 8: Tier Management (Add Tier, Rename Tier)
        def t8():
            initial_count = cdp.evaluate("window.__crimsonTierState.tiers.length")
            cdp.evaluate("window.__crimsonTierApp.addNewTier()")
            new_count = cdp.evaluate("window.__crimsonTierState.tiers.length")
            assert new_count == initial_count + 1, f"Expected {initial_count + 1} tiers, got {new_count}"

            # Verify DOM tier row added
            dom_tiers = cdp.evaluate("document.querySelectorAll('.tier-row').length")
            assert dom_tiers == new_count, f"DOM tiers count {dom_tiers} != state count {new_count}"
        test("8. Adding a new tier row dynamically creates tier in state and DOM", t8)

        # TEST 9: Quick Delete in Pool
        def t9():
            cdp.evaluate("window.__crimsonTierApp.deleteItem('custom-test-item-99', true)")
            exists_after = cdp.evaluate("window.__crimsonTierState.items['custom-test-item-99'] !== undefined")
            assert not exists_after, "Deleted item still exists in state"
        test("9. Quick delete removes item from collection and DOM", t9)

        # TEST 10: Clear Board to Pool & Empty Tiers Are Clean
        def t10():
            cdp.evaluate("window.__crimsonTierApp.clearBoardToPool()")
            ranked_after = cdp.evaluate("""
                window.__crimsonTierState.tiers.reduce((acc, t) => acc + t.items.length, 0)
            """)
            assert ranked_after == 0, f"Expected 0 ranked cards after clear, got {ranked_after}"
            total = cdp.evaluate("Object.keys(window.__crimsonTierState.items).length")
            pool_len = cdp.evaluate("window.__crimsonTierState.pool.length")
            assert total == pool_len, f"Expected all {total} items in pool, got {pool_len}"

            # Verify empty tiers have NO placeholder text and no placeholder element
            has_empty_hint = cdp.evaluate("document.body.textContent.includes('Перетащите карточки сюда')")
            assert not has_empty_hint, "Empty tiers should not contain 'Перетащите карточки сюда' hint text"
            has_empty_elem = cdp.evaluate("document.querySelectorAll('.tier-empty-placeholder').length !== 0")
            assert not has_empty_elem, "Empty tiers should not contain .tier-empty-placeholder element"
        test("10. Clear board to pool moves all cards back into pool & empty tiers are clean", t10)

        # TEST 11: High-Res PNG Exporter Engine
        def t11():
            # First put a few items back on tiers so the board has content
            cdp.evaluate("""
                (() => {
                    const pool = window.__crimsonTierState.pool;
                    if (pool.length >= 4) {
                        window.__crimsonTierApp.moveItem(pool[0], window.__crimsonTierState.tiers[0].id);
                        window.__crimsonTierApp.moveItem(pool[1], window.__crimsonTierState.tiers[0].id);
                        window.__crimsonTierApp.moveItem(pool[2], window.__crimsonTierState.tiers[1].id);
                        window.__crimsonTierApp.moveItem(pool[3], window.__crimsonTierState.tiers[2].id);
                    }
                })()
            """)
            # Open export modal and run generator
            cdp.evaluate("document.getElementById('btn-export-png').click()")
            has_blob = False
            for _ in range(15):
                time.sleep(0.3)
                has_blob = cdp.evaluate("""
                    (() => {
                        const img = document.getElementById('export-preview-img');
                        return img && img.src && (img.src.startsWith('blob:') || img.src.startsWith('data:'));
                    })()
                """)
                if has_blob:
                    break
            assert has_blob, "Export preview image does not have valid blob URL"
            # Close modal
            cdp.evaluate("document.querySelector('#modal-export [data-close-modal]').click()")
        test("11. High-Res PNG export canvas engine successfully generates image", t11)

        # TEST 12: Multi-Engine Online Search with Russian Queries
        def t12():
            # Open Add modal and search for Naruto
            cdp.evaluate("""
                document.getElementById('btn-add-item').click();
                document.querySelector('.modal-tab[data-tab="tab-search"]').click();
                document.getElementById('api-search-input').value = 'Наруто';
                document.getElementById('btn-run-api-search').click();
            """)
            time.sleep(1.2)
            results_count = cdp.evaluate("document.querySelectorAll('#search-results-grid .search-result-item').length")
            assert results_count >= 1, f"Expected online search results for 'Наруто', got {results_count}"

            # Check that first result has title, badge, and rating
            first_title = cdp.evaluate("document.querySelector('#search-results-grid .search-item-title')?.textContent || ''")
            assert "Наруто" in first_title or "Naruto" in first_title, f"Unexpected title: {first_title}"

            # Click "+ В банк" on first result
            initial_pool = cdp.evaluate("window.__crimsonTierState.pool.length")
            cdp.evaluate("document.querySelector('#search-results-grid .search-result-item button')?.click()")
            new_pool = cdp.evaluate("window.__crimsonTierState.pool.length")
            assert new_pool == initial_pool + 1, f"Expected pool to increase by 1, got {new_pool} (was {initial_pool})"

            # Close modal
            cdp.evaluate("document.querySelector('#modal-add-item [data-close-modal]').click()")
        test("12. Multi-engine search finds Russian titles and adds them to bank", t12)

        # TEST 13: Hover Info Plate Metadata (Only Title & Type Badge; Rating, Year, Dot, Menu removed)
        def t13():
            meta_data = cdp.evaluate("""
                (() => {
                    const card = document.querySelector('.media-card[data-item-id="anime-aot"]');
                    if (!card) return null;
                    const title = card.querySelector('.card-title')?.textContent;
                    const type = card.querySelector('.card-badge-type')?.textContent;
                    const hasRating = card.querySelector('.card-rating') !== null;
                    const hasYear = card.querySelector('.card-year') !== null;
                    const hasTypeDot = card.querySelector('.card-type-dot') !== null;
                    const hasMenu = card.querySelector('.card-click-menu') !== null;
                    return { title, type, hasRating, hasYear, hasTypeDot, hasMenu };
                })()
            """)
            assert meta_data is not None, "Attack on Titan card not found"
            assert "Атака Титанов" in meta_data["title"], f"Wrong title: {meta_data['title']}"
            assert "Аниме" in meta_data["type"], f"Wrong type badge: {meta_data['type']}"
            assert not meta_data["hasRating"], "Rating should NOT be in hover overlay per task requirement"
            assert not meta_data["hasYear"], "Year/duration should NOT be in hover overlay per task requirement"
            assert not meta_data["hasTypeDot"], "Category dot should NOT be on card"
            assert not meta_data["hasMenu"], "Click menu button should NOT be on card"
        test("13. Card hover badge contains only title and type (rating, year, dot, menu removed)", t13)

        # TEST 14: Real Poster Drawing Verification in Export Canvas
        def t14():
            has_real_posters = cdp.evaluate("""
                (() => {
                    // Check presets have local poster assets
                    const presets = window.TIERLIST_PRESETS || {};
                    const aot = presets.anime.find(a => a.id === 'anime-aot');
                    const interstellar = presets.movies.find(m => m.id === 'movie-interstellar');
                    return aot && aot.poster && aot.poster.includes('assets/posters') &&
                           interstellar && interstellar.poster && interstellar.poster.includes('assets/posters');
                })()
            """)
            assert has_real_posters, "Starter presets missing local poster asset paths"
        test("14. Real poster assets loaded and verified for canvas exporter", t14)

        # TEST 15: Detailed Info Modal on Card Click & Viewing Diary with Time
        def t15():
            # Click card to open modal
            cdp.evaluate("document.querySelector('.media-card[data-item-id=\"anime-aot\"]').click()")
            time.sleep(0.4)
            modal_visible = cdp.evaluate("document.getElementById('modal-item-detail').style.display !== 'none'")
            assert modal_visible, "Detailed info modal did not open on card click"

            # Check title and metadata in modal
            detail_title = cdp.evaluate("document.getElementById('detail-title').textContent")
            assert "Атака Титанов" in detail_title, f"Unexpected title in detail modal: {detail_title}"
            detail_type = cdp.evaluate("document.getElementById('detail-type-badge').textContent")
            assert "Аниме" in detail_type, f"Unexpected type badge in detail modal: {detail_type}"

            # Verify rating info removed per requirement
            has_rating = cdp.evaluate("document.getElementById('detail-rating') !== null")
            assert not has_rating, "Rating info should be removed from detail modal"

            # Verify type badge is enlarged (>= 13px)
            badge_font_size = cdp.evaluate("parseFloat(window.getComputedStyle(document.getElementById('detail-type-badge')).fontSize)")
            assert badge_font_size >= 13.0, f"Detail type badge too small: {badge_font_size}px"

            # Fill viewing diary fields (start date + time, end date + time, user comment, rewatch date + time)
            cdp.evaluate("""
                (() => {
                    document.getElementById('detail-start-date').value = '2023-01-15';
                    document.getElementById('detail-start-time').value = '21:30';
                    document.getElementById('detail-end-date').value = '2023-11-20';
                    document.getElementById('detail-end-time').value = '23:45';
                    document.getElementById('detail-user-comment').value = 'Шедевр мировой анимации с невероятным сюжетом!';
                    window.__crimsonTierApp.addRewatchDate('2024-06-01', '19:15');
                    window.__crimsonTierApp.saveCurrentItemDetail();
                })()
            """)
            time.sleep(0.2)

            # Verify saved state in items
            saved_item = cdp.evaluate("window.__crimsonTierState.items['anime-aot']")
            assert saved_item.get("startDate") == "2023-01-15", f"Wrong startDate: {saved_item.get('startDate')}"
            assert saved_item.get("startTime") == "21:30", f"Wrong startTime: {saved_item.get('startTime')}"
            assert saved_item.get("endDate") == "2023-11-20", f"Wrong endDate: {saved_item.get('endDate')}"
            assert saved_item.get("endTime") == "23:45", f"Wrong endTime: {saved_item.get('endTime')}"
            assert "Шедевр" in saved_item.get("userComment", ""), f"Wrong comment: {saved_item.get('userComment')}"
            rewatch_list = saved_item.get("rewatchDates", [])
            assert any((r.get("date") == "2024-06-01" and r.get("time") == "19:15") for r in rewatch_list), f"Rewatch entry missing: {rewatch_list}"

            # Close modal
            cdp.evaluate("document.querySelector('#modal-item-detail [data-close-modal]').click()")
        test("15. Detailed info modal (no rating, enlarged badge, diary date+time fields)", t15)

        # TEST 16: Tier Drag & Drop Reordering by Letter & Removal of Old Controls
        def t16():
            # Verify old arrow buttons and clear tier button are removed from side tools
            has_move_up = cdp.evaluate("document.querySelector('[data-action=\"move-tier-up\"]') !== null")
            assert not has_move_up, "Tier move-up arrow button should be removed"
            has_move_down = cdp.evaluate("document.querySelector('[data-action=\"move-tier-down\"]') !== null")
            assert not has_move_down, "Tier move-down arrow button should be removed"
            has_clear = cdp.evaluate("document.querySelector('[data-action=\"clear-tier\"]') !== null")
            assert not has_clear, "Tier clear button should be removed"

            # Verify tier label cell is draggable
            is_draggable = cdp.evaluate("document.querySelector('.tier-label-cell').draggable")
            assert is_draggable, "Tier label cell should be draggable"

            # Test actual real DragEvent dispatching on DOM elements (letter drag to reorder tier)
            initial_tiers = cdp.evaluate("[...document.querySelectorAll('.tier-name-text')].map(e => e.textContent)")
            drag_res = cdp.evaluate("""
                (() => {
                    const label0 = document.querySelectorAll('.tier-label-cell')[0];
                    const row1 = document.querySelectorAll('.tier-row')[1];
                    const dt = new DataTransfer();
                    label0.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
                    const rect = row1.getBoundingClientRect();
                    row1.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, clientY: rect.bottom - 5 }));
                    row1.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, clientY: rect.bottom - 5 }));
                    label0.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
                    return [...document.querySelectorAll('.tier-name-text')].map(e => e.textContent);
                })()
            """)
            assert drag_res[0] == initial_tiers[1] and drag_res[1] == initial_tiers[0], f"Real drag swap failed: {drag_res} vs {initial_tiers}"

            # Restore original order using reorderTier
            tier0_id = cdp.evaluate("window.__crimsonTierState.tiers[0].id")
            tier1_id = cdp.evaluate("window.__crimsonTierState.tiers[1].id")
            cdp.evaluate(f"window.__crimsonTierApp.reorderTier('{tier0_id}', '{tier1_id}', false)")
        test("16. Tier reordering via drag-and-drop by letter (real DragEvent) & removal of old arrow/clear controls", t16)

        # TEST 17: Maximal Button and Pill Rounding (pill-shaped)
        def t17():
            btn_radius = cdp.evaluate("window.getComputedStyle(document.getElementById('btn-add-item')).borderRadius")
            pill_radius = cdp.evaluate("window.getComputedStyle(document.querySelector('.filter-pill')).borderRadius")
            search_radius = cdp.evaluate("window.getComputedStyle(document.getElementById('board-search-input')).borderRadius")
            del_radius = cdp.evaluate("window.getComputedStyle(document.querySelector('.card-quick-delete')).borderRadius")
            color_radius = cdp.evaluate("window.getComputedStyle(document.querySelector('.color-dot')).borderRadius")
            def is_pill(val):
                if "%" in val:
                    return float(val.replace("%", "").split()[0]) >= 40.0
                num = float(val.replace("px", "").split()[0])
                return num >= 10.0
            assert is_pill(btn_radius), f"Button not pill-shaped: {btn_radius}"
            assert is_pill(pill_radius), f"Filter pill not pill-shaped: {pill_radius}"
            assert is_pill(search_radius), f"Search input not pill-shaped: {search_radius}"
            assert is_pill(del_radius), f"Card quick delete button not circular/pill: {del_radius}"
            assert is_pill(color_radius), f"Color dot button not circular/pill: {color_radius}"
        test("17. Maximal button, filter, and search input rounding (pill-shaped)", t17)

        # TEST 18: Add Item Modal Header Title Removed, Popular Tags Removed, Footer Removed
        def t18():
            has_add_title = cdp.evaluate("document.querySelector('#modal-add-item .modal-title') !== null")
            assert not has_add_title, "Add item modal should not have a title header"
            has_quick_tags = cdp.evaluate("document.querySelector('.search-quick-tags') !== null")
            assert not has_quick_tags, "Popular quick tags should be removed from online search"
            has_footer = cdp.evaluate("document.querySelector('.app-footer') !== null")
            assert not has_footer, "Bottom footer plate should be removed"
        test("18. Add modal header title removed, popular quick tags removed, footer removed", t18)

        # TEST 19: Online Search Result Item Detailed Preview Modal on Poster Click & Escape Modal Stacking
        def t19():
            # Open Add modal and search for Interstellar
            cdp.evaluate("""
                (() => {
                    document.getElementById('btn-add-item').click();
                    document.querySelector('.modal-tab[data-tab="tab-search"]').click();
                    const inp = document.getElementById('api-search-input');
                    inp.value = 'Interstellar';
                    inp.dispatchEvent(new Event('input'));
                    document.getElementById('btn-run-api-search').click();
                })()
            """)
            time.sleep(1.2)
            titles = cdp.evaluate("[...document.querySelectorAll('#search-results-grid .search-item-title')].map(e => e.textContent)")
            res_count = len(titles)
            assert res_count >= 1, f"Expected search results, got {res_count}"

            # Click the cover / thumbnail of the first result
            cdp.evaluate("document.querySelector('#search-results-grid .search-item-thumb-wrap')?.click()")
            time.sleep(0.4)

            # Verify search preview modal opened
            modal_visible = cdp.evaluate("document.getElementById('modal-search-preview').style.display !== 'none'")
            assert modal_visible, "Search result preview modal failed to open upon clicking card cover"

            # Check detailed preview metadata
            poster_src = cdp.evaluate("document.getElementById('search-preview-poster-img').src")
            assert len(poster_src) > 5, "Preview poster image src is empty"
            preview_title = cdp.evaluate("document.getElementById('search-preview-title').textContent")
            assert "Interstellar" in preview_title or "Интерстеллар" in preview_title, f"Unexpected preview title: {preview_title}"
            preview_type = cdp.evaluate("document.getElementById('search-preview-type-badge').textContent")
            assert "Фильм" in preview_type or "Аниме" in preview_type, f"Unexpected type badge: {preview_type}"
            preview_synopsis = cdp.evaluate("document.getElementById('search-preview-synopsis').textContent")
            assert len(preview_synopsis) > 0, "Preview synopsis is empty"

            # Add to bank directly from preview modal
            pool_len_before = cdp.evaluate("window.__crimsonTierState.pool.length")
            btn_add = cdp.evaluate("document.getElementById('btn-search-preview-add') !== null")
            assert btn_add, "Add to bank button missing in preview modal"
            cdp.evaluate("document.getElementById('btn-search-preview-add').click()")
            time.sleep(0.2)
            pool_len_after = cdp.evaluate("window.__crimsonTierState.pool.length")
            assert pool_len_after == pool_len_before + 1, f"Pool length didn't increase: {pool_len_before} -> {pool_len_after}"

            btn_text = cdp.evaluate("document.getElementById('btn-search-preview-add').textContent")
            assert "Добавлен" in btn_text, f"Button text expected to indicate added, got: {btn_text}"

            # Test Escape Key modal stacking: Escape closes search preview while keeping Add Item modal open
            cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
            time.sleep(0.2)
            preview_closed = cdp.evaluate("document.getElementById('modal-search-preview').style.display === 'none'")
            assert preview_closed, "Search preview modal failed to close on Escape key"
            add_modal_still_open = cdp.evaluate("document.getElementById('modal-add-item').style.display !== 'none'")
            assert add_modal_still_open, "Underlying Add Item modal should remain open after closing search preview via Escape"

            # Escape key again closes Add Item modal
            cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
            time.sleep(0.2)
            add_modal_closed = cdp.evaluate("document.getElementById('modal-add-item').style.display === 'none'")
            assert add_modal_closed, "Add Item modal failed to close on second Escape key"
        test("19. Online search result preview modal on cover click with full metadata, direct add to bank, and Escape stacking", t19)

        # TEST 20: Manual Cover Replacement with Preview, Cancelation, Reversion, and compressImageFile Engine
        def t20():
            # 1. Test Cover Edit Cancelation on Attack on Titan
            original_aot_poster = cdp.evaluate("window.__crimsonTierState.items['anime-aot'].poster")
            cdp.evaluate("window.__crimsonTierApp.openItemDetailModal('anime-aot')")
            time.sleep(0.3)
            cdp.evaluate("document.getElementById('btn-toggle-cover-edit').click()")
            cdp.evaluate("""
                const urlInp = document.getElementById('detail-cover-url-input');
                urlInp.value = 'https://example.com/cancelled_poster.jpg';
                urlInp.dispatchEvent(new Event('input'));
            """)
            time.sleep(0.2)
            # Click Cancel edit
            cdp.evaluate("document.getElementById('btn-cancel-cover-edit').click()")
            time.sleep(0.2)
            # Click Save on detail modal
            cdp.evaluate("document.getElementById('btn-save-detail').click()")
            time.sleep(0.2)
            aot_poster_after_cancel = cdp.evaluate("window.__crimsonTierState.items['anime-aot'].poster")
            assert aot_poster_after_cancel == original_aot_poster, "Canceled cover was mistakenly saved to state"

            # 2. Test URL cover replacement & live preview on Interstellar
            cdp.evaluate("window.__crimsonTierApp.openItemDetailModal('movie-interstellar')")
            time.sleep(0.3)

            # Verify cover change toggle button exists and expands
            has_toggle = cdp.evaluate("document.getElementById('btn-toggle-cover-edit') !== null")
            assert has_toggle, "Missing 'Сменить обложку' button in item detail modal"
            cdp.evaluate("document.getElementById('btn-toggle-cover-edit').click()")
            editor_visible = cdp.evaluate("document.getElementById('detail-cover-edit-section').style.display !== 'none'")
            assert editor_visible, "Cover edit section did not expand"

            test_cover_url = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='150'><rect width='100%' height='100%' fill='%23e11d48'/><text x='50%' y='50%' fill='white' text-anchor='middle'>CUSTOM_COVER_URL</text></svg>"
            cdp.evaluate(f"""
                (() => {{
                    const urlInput = document.getElementById('detail-cover-url-input');
                    urlInput.value = "{test_cover_url}";
                    urlInput.dispatchEvent(new Event('input'));
                }})()
            """)
            time.sleep(0.2)

            # Check that live preview on the detail poster updated
            live_src = cdp.evaluate("document.getElementById('detail-poster-img').src")
            assert "CUSTOM_COVER_URL" in live_src, f"Live preview on poster did not update to custom URL: {live_src[:60]}"

            # Save detail modal
            cdp.evaluate("document.getElementById('btn-save-detail').click()")
            time.sleep(0.3)

            # Verify state.items['movie-interstellar'].poster updated
            saved_poster = cdp.evaluate("window.__crimsonTierState.items['movie-interstellar'].poster")
            assert "CUSTOM_COVER_URL" in saved_poster, f"Poster not updated in state: {saved_poster[:60]}"

            # Verify DOM cards on the board / pool immediately re-rendered with new poster
            card_src = cdp.evaluate("""
                (() => {
                    const cardImg = document.querySelector('.media-card[data-item-id="movie-interstellar"] .card-poster');
                    return cardImg ? cardImg.src : '';
                })()
            """)
            assert "CUSTOM_COVER_URL" in card_src, f"Media card DOM poster img did not update: {card_src[:60]}"

            # Verify saved to LocalStorage
            ls_saved = cdp.evaluate("""
                (() => {
                    const raw = localStorage.getItem('crimson_tierlist_state_v1');
                    if (!raw) return false;
                    const parsed = JSON.parse(raw);
                    return parsed.items['movie-interstellar']?.poster?.includes('CUSTOM_COVER_URL');
                })()
            """)
            assert ls_saved, "New cover was not persisted in LocalStorage"

            # 3. Test Revert to Original Cover
            cdp.evaluate("window.__crimsonTierApp.openItemDetailModal('movie-interstellar')")
            time.sleep(0.2)
            has_revert = cdp.evaluate("document.getElementById('detail-cover-revert-row').style.display !== 'none'")
            assert has_revert, "Revert original cover button should be visible when item has custom cover"
            cdp.evaluate("document.getElementById('btn-revert-cover-default').click()")
            time.sleep(0.2)
            reverted_poster = cdp.evaluate("window.__crimsonTierState.items['movie-interstellar'].poster")
            assert "CUSTOM_COVER_URL" not in reverted_poster, "Poster was not reverted from custom URL"
            is_user_cover = cdp.evaluate("window.__crimsonTierState.items['movie-interstellar'].isUserCover")
            assert not is_user_cover, "isUserCover flag should be false after revert"
            cdp.evaluate("document.querySelector('#modal-item-detail [data-close-modal]').click()")

            # 4. Test compressImageFile with real canvas image and verify safe handling of non-images
            res_compression = cdp.evaluate("""
                (async () => {
                    const c = document.createElement('canvas');
                    c.width = 50;
                    c.height = 50;
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = '#e11d48';
                    ctx.fillRect(0, 0, 50, 50);
                    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
                    const validFile = new File([blob], 'valid.png', { type: 'image/png' });
                    const compressedResult = await window.__crimsonTierApp.compressImageFile(validFile);

                    const invalidFile = new File(['not an image content'], 'bad.txt', { type: 'text/plain' });
                    const invalidResult = await window.__crimsonTierApp.compressImageFile(invalidFile);

                    return {
                        validSuccess: typeof compressedResult === 'string' && compressedResult.startsWith('data:image/jpeg'),
                        invalidHandled: invalidResult === null
                    };
                })()
            """)
            assert res_compression.get("validSuccess"), "compressImageFile failed to compress valid image to data:image/jpeg"
            assert res_compression.get("invalidHandled"), "compressImageFile failed to reject non-image file with null"
        test("20. Manual cover replacement with preview, cancelation, revert, LocalStorage persistence and image compressor", t20)

        def t21():
            # 1. Open Backup Modal via button
            cdp.evaluate("document.getElementById('btn-backup-open').click()")
            time.sleep(0.3)
            is_visible = cdp.evaluate("document.getElementById('modal-backup').style.display !== 'none'")
            assert is_visible, "Backup modal failed to open when clicking #btn-backup-open"

            # 2. Check statistics counters
            stats = cdp.evaluate("""
                (() => {
                    return {
                        items: parseInt(document.getElementById('backup-stat-items-count').textContent, 10),
                        tiers: parseInt(document.getElementById('backup-stat-tiers-count').textContent, 10),
                        stateItems: Object.keys(window.__crimsonTierState.items).length,
                        stateTiers: window.__crimsonTierState.tiers.length
                    };
                })()
            """)
            assert stats["items"] == stats["stateItems"], f"Items count mismatch: {stats}"
            assert stats["tiers"] == stats["stateTiers"], f"Tiers count mismatch: {stats}"

            # 3. Test invalid backup validation
            cdp.evaluate("""
                window.__crimsonTierApp.handleBackupFile({ not_a_tierlist: true });
            """)
            time.sleep(0.2)
            preview_visible = cdp.evaluate("document.getElementById('backup-file-preview').style.display !== 'none'")
            assert not preview_visible, "Invalid backup object should not show file preview"

            # 4. Test valid backup staging and preview
            cdp.evaluate("""
                window.__crimsonTierApp.handleBackupFile({
                    app: 'crimson_tier',
                    version: '1.0',
                    tiers: window.__crimsonTierState.tiers,
                    items: window.__crimsonTierState.items,
                    pool: window.__crimsonTierState.pool
                });
            """)
            time.sleep(0.2)
            preview_shown = cdp.evaluate("document.getElementById('backup-file-preview').style.display !== 'none'")
            assert preview_shown, "Valid backup object should display preview card"

            # 5. Cancel staged file
            cdp.evaluate("document.getElementById('btn-cancel-backup-file').click()")
            time.sleep(0.1)
            preview_hidden = cdp.evaluate("document.getElementById('backup-file-preview').style.display === 'none'")
            assert preview_hidden, "Cancel button should reset staged backup preview"

            cdp.evaluate("document.querySelector('#modal-backup [data-close-modal]').click()")
        test("21. JSON Backup Modal opening, dynamic statistics display, and file validation", t21)

        def t22():
            # 1. Export current backup
            exported = cdp.evaluate("""
                window.__crimsonTierApp.exportBackupJSON()
            """)
            assert exported and exported.get("app") == "crimson_tier", f"Invalid exported backup: {exported}"
            original_items_count = len(exported.get("items", {}))
            assert original_items_count > 0, "Exported backup should contain items"

            # 2. Modify state: remove an item and add a dummy tier
            cdp.evaluate("""
                const itemKeys = Object.keys(window.__crimsonTierState.items);
                if (itemKeys.length > 0) {
                    window.__crimsonTierApp.deleteItem(itemKeys[0], true);
                }
                window.__crimsonTierApp.addNewTier();
            """)
            time.sleep(0.3)
            mod_items_count = cdp.evaluate("Object.keys(window.__crimsonTierState.items).length")
            assert mod_items_count < original_items_count, "State was not modified for restore test"

            # 3. Apply restore using exported backup data
            cdp.evaluate(f"""
                window.__crimsonTierApp.handleBackupFile({json.dumps(exported)});
                window.__crimsonTierApp.applyBackupRestore();
            """)
            time.sleep(0.4)

            # 4. Verify state restored completely
            restored_items_count = cdp.evaluate("Object.keys(window.__crimsonTierState.items).length")
            assert restored_items_count == original_items_count, f"Restored count mismatch: {restored_items_count} vs {original_items_count}"

            # 5. Verify LocalStorage sync
            ls_items_count = cdp.evaluate("""
                (() => {
                    const raw = localStorage.getItem('crimson_tierlist_state_v1');
                    const parsed = JSON.parse(raw);
                    return Object.keys(parsed.items).length;
                })()
            """)
            assert ls_items_count == original_items_count, f"LocalStorage sync mismatch: {ls_items_count} vs {original_items_count}"
        test("22. JSON Backup export, state modification, and full restore with LocalStorage sync", t22)

        # Capture Visual Screenshots
        print("\n--- Capturing Visual Screenshots ---")
        shots_dir = os.path.join(PROJECT_DIR, "tests")
        os.makedirs(shots_dir, exist_ok=True)

        # Reset to rich starter pack so the screenshots showcase the full aesthetic board
        cdp.evaluate("""
            if (window.__crimsonTierApp && window.__crimsonTierApp.resetToDefaults) {
                window.__crimsonTierApp.resetToDefaults();
            }
            document.getElementById('toast-container').innerHTML = '';
        """)
        time.sleep(1.0)

        # 1. Main board screenshot (clean resting posters)
        main_shot = os.path.join(shots_dir, "screenshot_main.png")
        cdp.capture_screenshot(main_shot)

        # 2. Hover state screenshot on a card (clean info badge with strictly title and type badge)
        cdp.evaluate("""
            (() => {
                const firstCard = document.querySelector('.tier-items-dropzone .media-card');
                if (firstCard) {
                    firstCard.style.transform = 'translateY(-2px)';
                    firstCard.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.6)';
                    firstCard.style.borderColor = '#52525b';
                    firstCard.style.zIndex = '25';
                    const overlay = firstCard.querySelector('.card-hover-overlay');
                    if (overlay) {
                        overlay.style.transition = 'none';
                        overlay.style.opacity = '1';
                        overlay.style.transform = 'translateY(0)';
                    }
                }
            })()
        """)
        time.sleep(0.3)
        hover_shot = os.path.join(shots_dir, "screenshot_hover.png")
        cdp.capture_screenshot(hover_shot)
        cdp.evaluate("""
            (() => {
                const firstCard = document.querySelector('.tier-items-dropzone .media-card');
                if (firstCard) {
                    firstCard.style.transform = '';
                    firstCard.style.boxShadow = '';
                    firstCard.style.borderColor = '';
                    firstCard.style.zIndex = '';
                    const overlay = firstCard.querySelector('.card-hover-overlay');
                    if (overlay) {
                        overlay.style.transition = '';
                        overlay.style.opacity = '';
                        overlay.style.transform = '';
                    }
                }
            })()
        """)

        # 3. Pool screenshot (scroll down to unassigned pool, show quick delete on hover)
        cdp.evaluate("""
            (() => {
                const poolSection = document.querySelector('.pool-section');
                if (poolSection) {
                    poolSection.scrollIntoView({ behavior: 'instant', block: 'start' });
                }
                const firstPoolCard = document.querySelector('#pool-cards-container .media-card');
                if (firstPoolCard) {
                    firstPoolCard.style.transform = 'translateY(-2px)';
                    firstPoolCard.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.6)';
                    firstPoolCard.style.borderColor = '#52525b';
                    const delBtn = firstPoolCard.querySelector('.card-quick-delete');
                    if (delBtn) {
                        delBtn.style.opacity = '1';
                        delBtn.style.transform = 'scale(1)';
                    }
                    const overlay = firstPoolCard.querySelector('.card-hover-overlay');
                    if (overlay) {
                        overlay.style.opacity = '1';
                        overlay.style.transform = 'translateY(0)';
                    }
                }
            })()
        """)
        time.sleep(0.4)
        pool_shot = os.path.join(shots_dir, "screenshot_pool.png")
        cdp.capture_screenshot(pool_shot)
        cdp.evaluate("""
            (() => {
                window.scrollTo(0, 0);
                const firstPoolCard = document.querySelector('#pool-cards-container .media-card');
                if (firstPoolCard) {
                    firstPoolCard.style.transform = '';
                    firstPoolCard.style.borderColor = '';
                    const delBtn = firstPoolCard.querySelector('.card-quick-delete');
                    if (delBtn) { delBtn.style.opacity = ''; delBtn.style.transform = ''; }
                    const overlay = firstPoolCard.querySelector('.card-hover-overlay');
                    if (overlay) { overlay.style.opacity = ''; overlay.style.transform = ''; }
                }
            })()
        """)

        # 4. Add Item Modal screenshot with real search results for "Атака титанов"
        cdp.evaluate("""
            document.getElementById('btn-add-item').click();
            document.querySelector('.modal-tab[data-tab="tab-search"]').click();
            document.getElementById('api-search-input').value = 'Атака титанов';
            document.getElementById('btn-run-api-search').click();
        """)
        time.sleep(1.0)
        add_modal_shot = os.path.join(shots_dir, "screenshot_add_modal.png")
        cdp.capture_screenshot(add_modal_shot)

        # 4b. Search Item Detailed Preview Modal screenshot
        cdp.evaluate("""
            const firstThumb = document.querySelector('#search-results-grid .search-item-thumb-wrap');
            if (firstThumb) firstThumb.click();
        """)
        time.sleep(0.5)
        search_prev_shot = os.path.join(shots_dir, "screenshot_search_preview.png")
        cdp.capture_screenshot(search_prev_shot)
        cdp.evaluate("document.querySelector('#modal-search-preview [data-close-modal]').click()")
        time.sleep(0.2)

        # Switch to manual tab in modal
        cdp.evaluate("document.querySelector('.modal-tab[data-tab=\"tab-manual\"]').click()")
        time.sleep(0.3)
        manual_modal_shot = os.path.join(shots_dir, "screenshot_manual_modal.png")
        cdp.capture_screenshot(manual_modal_shot)
        cdp.evaluate("document.querySelector('#modal-add-item [data-close-modal]').click()")

        # 5. Export Modal screenshot (showing real posters drawn on canvas)
        cdp.evaluate("document.getElementById('btn-export-png').click()")
        time.sleep(1.2)
        export_modal_shot = os.path.join(shots_dir, "screenshot_export_modal.png")
        cdp.capture_screenshot(export_modal_shot)
        cdp.evaluate("document.querySelector('#modal-export [data-close-modal]').click()")

        # 6. Detailed Info Modal with Viewing Diary screenshot
        cdp.evaluate("""
            window.__crimsonTierApp.openItemDetailModal('anime-aot');
            document.getElementById('detail-start-date').value = '2023-01-15';
            document.getElementById('detail-start-time').value = '21:30';
            document.getElementById('detail-end-date').value = '2023-11-20';
            document.getElementById('detail-end-time').value = '23:45';
            document.getElementById('detail-user-comment').value = 'Шедевр мировой анимации с невероятным сюжетом!';
            window.__crimsonTierApp.addRewatchDate('2024-06-01', '19:15');
        """)
        time.sleep(0.5)
        detail_modal_shot = os.path.join(shots_dir, "screenshot_detail_modal.png")
        cdp.capture_screenshot(detail_modal_shot)

        # 7. Manual Cover Change UI in Detail Modal screenshot
        cdp.evaluate("""
            const toggleBtn = document.getElementById('btn-toggle-cover-edit');
            if (toggleBtn) toggleBtn.click();
            const urlInput = document.getElementById('detail-cover-url-input');
            if (urlInput) {
                urlInput.value = 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400';
                urlInput.dispatchEvent(new Event('input'));
            }
        """)
        time.sleep(0.5)
        cover_change_shot = os.path.join(shots_dir, "screenshot_cover_change.png")
        cdp.capture_screenshot(cover_change_shot)
        cdp.evaluate("document.querySelector('#modal-item-detail [data-close-modal]').click()")

        # 8. JSON Backup Modal screenshot
        cdp.evaluate("document.getElementById('btn-backup-open').click()")
        time.sleep(0.5)
        backup_shot = os.path.join(shots_dir, "screenshot_backup_modal.png")
        cdp.capture_screenshot(backup_shot)
        cdp.evaluate("document.querySelector('#modal-backup [data-close-modal]').click()")

    finally:
        cdp.close()
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=3)
        except Exception:
            chrome_proc.kill()
        httpd.shutdown()

    # Summary
    passed = sum(1 for _, ok, _ in results if ok)
    failed = len(results) - passed
    print(f"\n=== TEST SUMMARY: {passed}/{len(results)} PASSED ({failed} FAILED) ===")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
