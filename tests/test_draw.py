import importlib
import unittest


class DrawTests(unittest.TestCase):
    def test_roll_count_limit_is_five_hundred_thousand(self):
        engine = importlib.import_module('engine')
        self.assertEqual(engine.MAX_ROLLS, 500_000)
        self.assertEqual(engine.validate_roll_range([500_000, 500_000]), (500_000, 500_000))

    def test_roll_counts_are_selected_independently_for_each_ticket(self):
        engine = importlib.import_module('engine')
        sequence = iter([0, 1, 2, 3, 0])

        def randbelow(limit):
            self.assertEqual(limit, 4)
            return next(sequence)

        self.assertEqual(engine.choose_roll_counts(5, (3, 6), randbelow=randbelow), [3, 4, 5, 6, 3])

    def test_roll_count_performs_every_requested_round(self):
        engine = importlib.import_module('engine')
        weights = {'red': [{'weight': 1} for _ in range(33)],
                   'blue': [{'weight': 1} for _ in range(16)]}
        calls = []

        def randbelow(limit):
            calls.append(limit)
            return 0

        engine.draw_ticket(weights, 2, randbelow=randbelow)
        self.assertEqual(len(calls), 14)

    def test_roll_range_rejects_invalid_bounds(self):
        engine = importlib.import_module('engine')
        for value in ((0, 1), (4, 3), (1, engine.MAX_ROLLS + 1), ('1', 2)):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    engine.choose_roll_counts(1, value, randbelow=lambda _: 0)

    def test_total_roll_cap_rejects_oversized_batch(self):
        engine = importlib.import_module('engine')
        self.assertEqual(engine.MAX_TOTAL_ROLLS, 100_000)
        # 注数 × 每注最大次数 超过上限时拒绝
        with self.assertRaises(ValueError):
            engine.validate_total_rolls(20, 5001)  # 100020 > 100000
        with self.assertRaises(ValueError):
            engine.validate_total_rolls(1, 100_001)
        # 恰好等于上限是允许的
        self.assertEqual(engine.validate_total_rolls(20, 5000), 100_000)
        self.assertEqual(engine.validate_total_rolls(1, 100_000), 100_000)

    def test_draw_batch_enforces_total_roll_cap(self):
        engine = importlib.import_module('engine')
        with self.assertRaises(ValueError):
            engine.draw_batch(20, 'uniform', 0, None, (5001, 5001))


if __name__ == '__main__':
    unittest.main()
