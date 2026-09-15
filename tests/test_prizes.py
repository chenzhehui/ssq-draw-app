import importlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


WINNING = {'issue': '2026106', 'red': [6, 11, 13, 14, 22, 30], 'blue': 14}


class PrizeTests(unittest.TestCase):
    def test_recognizes_each_standard_prize_and_only_highest_level(self):
        engine = importlib.import_module('engine')
        cases = [
            ([6, 11, 13, 14, 22, 30], 14, '一等奖'),
            ([6, 11, 13, 14, 22, 30], 1, '二等奖'),
            ([6, 11, 13, 14, 22, 31], 14, '三等奖'),
            ([6, 11, 13, 14, 22, 31], 1, '四等奖'),
            ([6, 11, 13, 14, 22, 31], 14, '三等奖'),
            ([6, 11, 13, 14, 23, 31], 14, '四等奖'),
            ([6, 11, 13, 14, 23, 31], 1, '五等奖'),
            ([6, 11, 13, 23, 24, 31], 14, '五等奖'),
            ([6, 11, 23, 24, 25, 31], 14, '六等奖'),
            ([1, 2, 3, 4, 5, 7], 1, '未中奖'),
        ]
        for red, blue, expected in cases:
            with self.subTest(red=red, blue=blue):
                result = engine.evaluate_ticket({'red': red, 'blue': blue}, WINNING)
                self.assertEqual(result['level'], expected)

    def test_fuyun_is_explicit_and_multiple_tickets_are_summarized(self):
        engine = importlib.import_module('engine')
        ticket = {'red': [6, 11, 13, 1, 2, 3], 'blue': 1}
        self.assertEqual(engine.evaluate_ticket(ticket, WINNING, fuyun_active=True)['level'], '福运奖')
        self.assertEqual(engine.evaluate_ticket(ticket, WINNING, fuyun_active=False)['level'], '未中奖')
        result = engine.check_tickets([{'red': [1, 2, 3, 4, 5, 7], 'blue': 14},
                                       {'red': WINNING['red'], 'blue': 1}], WINNING)
        self.assertEqual([item['level'] for item in result['results']], ['六等奖', '二等奖'])
        self.assertEqual(result['summary']['total'], 2)
        self.assertEqual(result['summary']['winning'], 2)
        self.assertEqual(result['summary']['by_level']['六等奖'], 1)

    def test_prize_amounts_distinguish_fixed_and_floating_awards(self):
        engine = importlib.import_module('engine')
        cases = [
            ([6, 11, 13, 14, 22, 30], 14, None, '浮动奖金'),
            ([6, 11, 13, 14, 22, 31], 14, 3000, '3000元'),
            ([6, 11, 23, 24, 25, 31], 14, 5, '5元'),
            ([1, 2, 3, 4, 5, 7], 1, 0, '0元'),
        ]
        for red, blue, amount, display in cases:
            with self.subTest(red=red, blue=blue):
                result = engine.evaluate_ticket({'red': red, 'blue': blue}, WINNING)
                self.assertEqual(result['prize_amount'], amount)
                self.assertEqual(result['prize_display'], display)

    def test_rejects_invalid_ticket_and_winning_draw(self):
        engine = importlib.import_module('engine')
        with self.assertRaises(ValueError):
            engine.evaluate_ticket({'red': [1, 1, 2, 3, 4, 5], 'blue': 1}, WINNING)
        with self.assertRaises(ValueError):
            engine.check_tickets([], WINNING)
        with self.assertRaises(ValueError):
            engine.evaluate_ticket({'red': [1, 2, 3, 4, 5, 6], 'blue': 1}, {'red': [1], 'blue': 1})


if __name__ == '__main__':
    unittest.main()
