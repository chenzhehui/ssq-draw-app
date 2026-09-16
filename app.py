"""Local-only, standard-library web application. Python 3.10+."""

import argparse
import copy
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import sys
import threading
import time
from urllib.parse import urlsplit, parse_qs
import webbrowser

from engine import SOURCE, calculate_weights, check_tickets, draw_batch, fetch_history, validate_history

ROOT = Path(__file__).resolve().parent
MAX_AGE = 24 * 3600
REFRESH_INTERVAL_HOURS = 12
PUBLIC_ORIGIN = os.environ.get('SSQ_PUBLIC_ORIGIN', '').strip().rstrip('/')


def timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value else None


class DataStore:
    def __init__(self, folder, fetcher=fetch_history, clock=time.time):
        self.folder, self.fetcher, self.clock = Path(folder), fetcher, clock
        self.lock, self.stop = threading.RLock(), threading.Event()
        self.history, self.last_success, self.error, self.busy = [], 0, None, False
        self.interval_hours, self.next_due = REFRESH_INTERVAL_HOURS, self.clock()
        try:
            data = json.loads((self.folder / 'history.json').read_text(encoding='utf-8'))
            history = validate_history(data['draws'])
            checked_at = float(data['checked_at'])
            if not 0 < checked_at <= self.clock():
                raise ValueError('Invalid cached time')
            self.history, self.last_success = history, checked_at
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def _save(self, name, data):
        self.folder.mkdir(parents=True, exist_ok=True)
        target = self.folder / name
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(target)

    def refresh(self):
        with self.lock:
            if self.busy:
                return
            self.busy = True
        self._perform_refresh()

    def _perform_refresh(self):
        try:
            history = validate_history(self.fetcher())
            checked_at = self.clock()
            with self.lock:
                if self.history and history[0]['issue'] < self.history[0]['issue']:
                    raise ValueError('来源返回了比缓存更旧的期号，拒绝回退')
                self._save('history.json', {'source': SOURCE, 'checked_at': checked_at, 'draws': history})
                self.history, self.last_success, self.error = history, checked_at, None
                self.next_due = checked_at + self.interval_hours * 3600
        except Exception as error:
            with self.lock:
                self.error = f'无法获取数据：{error}'
                self.next_due = self.clock() + 600
        finally:
            with self.lock:
                self.busy = False

    def request_refresh(self):
        with self.lock:
            if self.busy:
                return
            self.busy = True
            try:
                threading.Thread(target=self._perform_refresh, daemon=True).start()
            except RuntimeError:
                self.busy = False
                raise

    def state(self):
        with self.lock:
            available = bool(self.history and not self.error and 0 <= self.clock() - self.last_success < MAX_AGE)
            return {'app_id': 'ssq-local-draw', 'source': SOURCE, 'latest3': copy.deepcopy(self.history[:3]),
                    'count': len(self.history), 'last_success': timestamp(self.last_success),
                    'weighted_available': available, 'error': self.error, 'refreshing': self.busy,
                    'interval_hours': self.interval_hours, 'next_refresh': timestamp(self.next_due),
                    'next_refresh_in': max(0, round(self.next_due - self.clock())),
                    'rule': '1 + 上限 × (近10期次数 - 此前10期次数) / 10；上限不是训练结果。'}

    def weighted_history(self):
        return self.weighted_snapshot()[0]

    def weighted_snapshot(self):
        with self.lock:
            if not self.state()['weighted_available']:
                raise RuntimeError('无法获取数据，或数据已过期。请更新数据或主动切换纯随机。')
            return copy.deepcopy(self.history), timestamp(self.last_success)

    def latest_draw(self):
        with self.lock:
            if not self.history or self.error or not 0 <= self.clock() - self.last_success < MAX_AGE:
                raise RuntimeError('无法获取有效的最新开奖数据，暂时不能算奖。')
            return copy.deepcopy(self.history[0]), timestamp(self.last_success)

    def draw_for_issue(self, issue):
        if not isinstance(issue, str) or not re.fullmatch(r'20\d{5}', issue):
            raise ValueError('开奖期号无效')
        with self.lock:
            if not self.history or self.error or not 0 <= self.clock() - self.last_success < MAX_AGE:
                raise RuntimeError('无法获取有效的最新开奖数据，暂时不能算奖。')
            for draw in self.history:
                if draw['issue'] == issue:
                    return copy.deepcopy(draw), timestamp(self.last_success), None
            latest_issue = self.history[0]['issue']
            if issue > latest_issue:
                return None, timestamp(self.last_success), latest_issue
            raise RuntimeError(f'缓存中没有第{issue}期的真实开奖数据，暂时不能算奖。')

    def run_scheduler(self):
        while not self.stop.is_set():
            with self.lock:
                due = self.next_due - self.clock()
            if due <= 0:
                self.refresh()
            self.stop.wait(min(max(self.next_due - self.clock(), 1), 60))


def create_server(store, port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def send(self, status, data, content_type='application/json; charset=utf-8'):
            body = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, (dict, list)) else data
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def allowed(self, post=False):
            origin = f'http://127.0.0.1:{self.server.server_port}'
            allowed_origins = {origin}
            if PUBLIC_ORIGIN:
                allowed_origins.add(PUBLIC_ORIGIN)
            allowed_hosts = {(o.split('://', 1)[1] if '://' in o else o) for o in allowed_origins}
            if self.headers.get('Host') not in allowed_hosts:
                self.send(403, {'error': '仅允许本机地址访问'})
                return False
            if post and (self.headers.get('Origin') not in (None, *allowed_origins)
                         or not secrets.compare_digest(self.headers.get('X-App-Token', ''), self.server.token)):
                self.send(403, {'error': '本地请求校验失败，请刷新页面'})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            parsed = urlsplit(self.path)
            if parsed.path == '/api/state':
                self.send(200, {**store.state(), 'token': self.server.token})
            elif parsed.path == '/api/weights':
                try:
                    strength = int(parse_qs(parsed.query).get('strength', ['5'])[0])
                    history = store.weighted_history()
                    self.send(200, {'weights': calculate_weights(history, strength), 'latest_issue': history[0]['issue'], 'strength': strength})
                except (ValueError, RuntimeError) as error:
                    self.send(503, {'error': str(error)})
            else:
                files = {'/': ('index.html', 'text/html; charset=utf-8'),
                         '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                         '/style.css': ('style.css', 'text/css; charset=utf-8'),
                         '/trial.html': ('trial.html', 'text/html; charset=utf-8'),
                         '/trial.js': ('trial.js', 'text/javascript; charset=utf-8'),
                         '/trial.css': ('trial.css', 'text/css; charset=utf-8'),
                         '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
                if parsed.path not in files:
                    self.send(404, {'error': 'Not found'})
                    return
                name, mime = files[parsed.path]
                try:
                    self.send(200, (ROOT / 'static' / name).read_bytes(), mime)
                except OSError:
                    self.send(404, {'error': '页面文件缺失'})

        def do_POST(self):
            if not self.allowed(post=True):
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('需要有效且不超过4KB的JSON请求')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('需要JSON对象')
                if self.path == '/api/draw':
                    mode = data.get('mode', 'uniform')
                    history, checked_at = store.weighted_snapshot() if mode == 'weighted' else (None, None)
                    batch = draw_batch(data.get('count', 5), mode, data.get('strength', 5), history)
                    batch['data_checked_at'] = checked_at
                    self.send(200, batch)
                elif self.path == '/api/reroll':
                    mode = data.get('mode', 'uniform')
                    history, checked_at = store.weighted_snapshot() if mode == 'weighted' else (None, None)
                    strength = data.get('strength', 5 if mode == 'weighted' else 0)
                    batch = draw_batch(1, mode, strength, history)
                    self.send(200, {'ticket': batch['tickets'][0], 'data_checked_at': checked_at})
                elif self.path == '/api/refresh':
                    store.request_refresh()
                    self.send(202, {'accepted': True})
                elif self.path == '/api/check':
                    winning_draw, checked_at, latest_issue = store.draw_for_issue(data.get('issue'))
                    if winning_draw is None:
                        self.send(200, {'pending': True, 'issue': data['issue'], 'latest_issue': latest_issue,
                                        'checked_at': checked_at})
                        return
                    result = check_tickets(data.get('tickets'), winning_draw, data.get('fuyun_active', False))
                    result['checked_at'] = checked_at
                    self.send(200, result)
                else:
                    self.send(404, {'error': 'Not found'})
            except RuntimeError as error:
                self.send(503, {'error': str(error)})
            except (ValueError, KeyError, TypeError) as error:
                self.send(400, {'error': str(error)})
            except OSError:
                self.send(503, {'error': '系统随机源或本地存储不可用，已停止操作；没有切换弱随机源。'})

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.token = secrets.token_hex(32)
    return server


def main():
    parser = argparse.ArgumentParser(description='Local SSQ draw application')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--strict-port', action='store_true', help='Fail instead of selecting another port')
    args = parser.parse_args()
    store = DataStore(ROOT / 'data')
    try:
        server = create_server(store, args.port)
    except OSError as error:
        if args.strict_port:
            print(f'Cannot bind 127.0.0.1:{args.port}: {error}', file=sys.stderr)
            return 1
        server = create_server(store, 0)
    address = f'http://127.0.0.1:{server.server_port}'
    threading.Thread(target=store.run_scheduler, daemon=True).start()
    print(f'SSQ draw is running at {address}\nClose this window or press Ctrl+C to stop.', flush=True)
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        store.stop.set()
        server.server_close()


if __name__ == '__main__':
    sys.exit(main())
