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


if __name__ == '__main__':
    unittest.main()
