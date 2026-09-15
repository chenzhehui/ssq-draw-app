import importlib
import json
import tempfile
import unittest
from pathlib import Path


class RefreshScheduleTests(unittest.TestCase):
    def test_refresh_interval_ignores_legacy_setting(self):
        app = importlib.import_module('app')
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'settings.json').write_text(
                json.dumps({'interval_hours': 1}), encoding='utf-8'
            )
            store = app.DataStore(Path(folder), fetcher=lambda: [])
            self.assertEqual(store.interval_hours, 12)


if __name__ == '__main__':
    unittest.main()
