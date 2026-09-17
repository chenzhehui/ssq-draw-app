import importlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class PrizeHTTPTests(unittest.TestCase):
    def test_draw_keeps_ticket_count_and_returns_independent_roll_counts(self):
        app = importlib.import_module('app')
        with tempfile.TemporaryDirectory() as folder:
            store = app.DataStore(Path(folder), fetcher=lambda: [])
            server = app.create_server(store, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/api/state') as response:
                    state = json.load(response)
                headers = {'Content-Type': 'application/json', 'X-App-Token': state['token']}
                body = json.dumps({'count': 5, 'mode': 'uniform', 'strength': 0, 'roll_range': [2, 4]}).encode()
                with urlopen(Request(base + '/api/draw', data=body, headers=headers)) as response:
                    result = json.load(response)
                self.assertEqual(len(result['tickets']), 5)
                self.assertEqual(len(result['roll_counts']), 5)
                self.assertTrue(all(2 <= count <= 4 for count in result['roll_counts']))
                self.assertEqual(result['snapshot']['roll_range'], [2, 4])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_draw_is_rejected_when_concurrency_limit_is_exhausted(self):
        app = importlib.import_module('app')
        with tempfile.TemporaryDirectory() as folder:
            store = app.DataStore(Path(folder), fetcher=lambda: [])
            server = app.create_server(store, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/api/state') as response:
                    state = json.load(response)
                headers = {'Content-Type': 'application/json', 'X-App-Token': state['token']}
                body = json.dumps({'count': 1, 'mode': 'uniform', 'strength': 0}).encode()
                # 占满全部并发名额
                self.assertTrue(server.draw_semaphore.acquire(blocking=False))
                self.assertTrue(server.draw_semaphore.acquire(blocking=False))
                try:
                    with self.assertRaises(HTTPError) as caught:
                        urlopen(Request(base + '/api/draw', data=body, headers=headers))
                    self.assertEqual(caught.exception.code, 503)
                    caught.exception.close()
                finally:
                    server.draw_semaphore.release()
                    server.draw_semaphore.release()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_trial_page_and_assets_are_served(self):
        app = importlib.import_module('app')
        with tempfile.TemporaryDirectory() as folder:
            store = app.DataStore(Path(folder), fetcher=lambda: [])
            server = app.create_server(store, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                for path, marker in (('/trial.html', '<title>一摇 · 试命</title>'),
                                     ('/trial.js', 'function stopTrial'),
                                     ('/trial.css', '.trial-layout')):
                    with urlopen(base + path) as response:
                        body = response.read().decode('utf-8')
                    self.assertIn(marker, body)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_reroll_returns_one_ticket(self):
        app = importlib.import_module('app')
        with tempfile.TemporaryDirectory() as folder:
            store = app.DataStore(Path(folder), fetcher=lambda: [])
            server = app.create_server(store, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/api/state') as response:
                    state = json.load(response)
                headers = {'Content-Type': 'application/json', 'X-App-Token': state['token']}
                body = json.dumps({'mode': 'uniform', 'strength': 0}).encode()
                with urlopen(Request(base + '/api/reroll', data=body, headers=headers)) as response:
                    result = json.load(response)
                self.assertIn('ticket', result)
                self.assertEqual(len(result['ticket']['red']), 6)
                self.assertEqual(len(set(result['ticket']['red'])), 6)
                self.assertGreaterEqual(result['ticket']['blue'], 1)
                self.assertLessEqual(result['ticket']['blue'], 16)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_check_uses_server_latest_draw_and_rejects_bad_ticket(self):
        app = importlib.import_module('app')
        with tempfile.TemporaryDirectory() as folder:
            store = app.DataStore(Path(folder), fetcher=lambda: [])
            store.history = [{'issue': '2026106', 'red': [6, 11, 13, 14, 22, 30], 'blue': 14}]
            store.last_success = time.time()
            server = app.create_server(store, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/api/state') as response:
                    state = json.load(response)
                headers = {'Content-Type': 'application/json', 'X-App-Token': state['token']}
                body = json.dumps({'tickets': [
                    {'red': [6, 11, 13, 14, 22, 30], 'blue': 14},
                    {'red': [1, 2, 3, 4, 5, 7], 'blue': 14},
                ], 'issue': '2026106'}).encode()
                with urlopen(Request(base + '/api/check', data=body, headers=headers)) as response:
                    result = json.load(response)
                self.assertEqual(result['issue'], '2026106')
                self.assertEqual([row['level'] for row in result['results']], ['一等奖', '六等奖'])

                pending = json.dumps({'tickets': [
                    {'red': [6, 11, 13, 14, 22, 30], 'blue': 14},
                ], 'issue': '2026107'}).encode()
                with urlopen(Request(base + '/api/check', data=pending, headers=headers)) as response:
                    pending_result = json.load(response)
                self.assertTrue(pending_result['pending'])
                self.assertEqual(pending_result['latest_issue'], '2026106')

                bad = json.dumps({'tickets': [{'red': [1, 1, 2, 3, 4, 5], 'blue': 1}]}).encode()
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(base + '/api/check', data=bad, headers=headers))
                self.assertEqual(caught.exception.code, 400)
                caught.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
