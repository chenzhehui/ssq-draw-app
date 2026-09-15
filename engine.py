"""OS-backed random drawing and bounded, optional history preferences."""

from collections import Counter
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import re
import secrets
from urllib.request import Request, urlopen

SOURCE = 'https://www.gdfc.org.cn/charts/ssq/indicators.html?period=50'
RULE_VERSION = 'micro-delta-v1'
BASE_WEIGHT = 10000


class DrawTableParser(HTMLParser):
    """Row-scoped parser adapted from the existing ssq-live-analysis skill."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row, self.cell = [], None
        elif tag == 'td' and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'tr':
            if self.row is not None:
                self.rows.append(self.row)
            self.row, self.cell = None, None


def validate_history(draws, limit=50):
    if not isinstance(draws, list) or len(draws) < limit:
        raise ValueError(f'真实开奖数据不足{limit}期')
    normalized, seen = [], set()
    for d in draws:
        issue = str(d['issue'])
        if not re.fullmatch(r'20\d{5}', issue) or issue in seen:
            raise ValueError('开奖期号无效或重复')
        red, blue = sorted(int(n) for n in d['red']), int(d['blue'])
        if len(red) != 6 or len(set(red)) != 6 or not all(1 <= n <= 33 for n in red) or not 1 <= blue <= 16:
            raise ValueError('开奖号码数量、范围或唯一性校验失败')
        seen.add(issue)
        normalized.append({'issue': issue, 'red': red, 'blue': blue})
    return sorted(normalized, key=lambda d: d['issue'], reverse=True)[:limit]


def parse_history(html, limit=50):
    parser = DrawTableParser()
    parser.feed(html)
    pattern = re.compile(r'\s*' + r'\s*,\s*'.join([r'(\d{2})'] * 6) + r'\s*;\s*(\d{2})\s*')
    draws = []
    for row in parser.rows:
        if not row or not re.fullmatch(r'20\d{5}', row[0]):
            continue
        match = pattern.fullmatch(row[1]) if len(row) > 1 else None
        if not match:
            raise ValueError(f'无法解析{row[0]}期号码')
        draws.append({'issue': row[0], 'red': list(match.groups()[:6]), 'blue': match.group(7)})
    return validate_history(draws, limit)


def fetch_history():
    request = Request(SOURCE, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.gdfc.org.cn/'})
    with urlopen(request, timeout=20) as response:
        html = response.read(2_000_001)
    if len(html) > 2_000_000:
        raise ValueError('数据页过大，已停止解析')
    return parse_history(html.decode('utf-8', errors='replace'))


def calculate_weights(history, strength=5):
    if type(strength) is not int or not 0 <= strength <= 10:
        raise ValueError('微调上限只能为0-10%的整数')
    history = validate_history(history, limit=20)
    result = {}
    for color, domain in (('red', 33), ('blue', 16)):
        def counts(window):
            return Counter(n for draw in window for n in (draw['red'] if color == 'red' else [draw['blue']]))
        recent, previous = counts(history[:10]), counts(history[10:20])
        rows = []
        for n in range(1, domain + 1):
            delta = recent[n] - previous[n]
            # Symmetric integer rounding; the cap is a preference, not a fitted parameter.
            adjustment = ((abs(delta) * strength * 100 + 5) // 10) * (1 if delta >= 0 else -1)
            rows.append({'number': n, 'weight': BASE_WEIGHT + adjustment,
                         'recent': recent[n], 'previous': previous[n], 'delta': delta})
        result[color] = rows
    return result


def sample_without_replacement(weights, count, randbelow=None):
    if not 0 <= count <= len(weights) or any(type(w) is not int or w <= 0 for w in weights):
        raise ValueError('无效的抽样权重或数量')
    randbelow = randbelow or secrets.randbelow
    pool = list(enumerate(weights, start=1))
    selected = []
    for _ in range(count):
        total = sum(weight for _, weight in pool)
        roll = randbelow(total)
        if not 0 <= roll < total:
            raise ValueError('随机源返回值越界')
        for index, (number, weight) in enumerate(pool):
            if roll < weight:
                selected.append(number)
                pool.pop(index)
                break
            roll -= weight
    return selected


def draw_batch(count=5, mode='uniform', strength=5, history=None):
    if type(count) is not int or not 1 <= count <= 20:
        raise ValueError('每次只能摇1-20注')
    if mode not in ('uniform', 'weighted') or type(strength) is not int or not 0 <= strength <= 10:
        raise ValueError('摇号模式或微调上限无效')
    if mode == 'weighted':
        if not history:
            raise ValueError('无法获取数据，不能使用微调模式')
        history = validate_history(history)
        weights = calculate_weights(history, strength)
    else:
        weights = {color: [{'number': n, 'weight': BASE_WEIGHT} for n in range(1, maximum + 1)]
                   for color, maximum in (('red', 33), ('blue', 16))}
    snapshot = {'rule_version': RULE_VERSION if mode == 'weighted' else 'uniform-v1',
                'mode': mode, 'strength': strength if mode == 'weighted' else 0,
                'latest_issue': history[0]['issue'] if mode == 'weighted' else None,
                'weights': weights}
    snapshot_id = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    tickets = []
    for _ in range(count):
        red = sample_without_replacement([r['weight'] for r in weights['red']], 6)
        blue = sample_without_replacement([r['weight'] for r in weights['blue']], 1)[0]
        tickets.append({'red': sorted(red), 'blue': blue})
    return {'batch_id': secrets.token_hex(8), 'created_at': datetime.now(timezone.utc).isoformat(),
            'tickets': tickets, 'snapshot_id': snapshot_id, 'snapshot': snapshot,
            'random_source': 'secrets.randbelow / OS CSPRNG',
            'notice': '允许跨注重复；加权是偏好，不是经过验证的中奖优势。'}
