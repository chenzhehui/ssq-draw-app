from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class FrontendControlTests(unittest.TestCase):
    def test_clear_current_numbers_control_is_wired(self):
        html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
        script = (ROOT / 'static/app.js').read_text(encoding='utf-8')
        self.assertIn('id="clear"', html)
        self.assertIn('清空我的号码', html)
        self.assertIn('function clearCurrent()', script)
        self.assertIn("$('clear').addEventListener('click', clearCurrent)", script)

    def test_recent_batches_have_period_and_clear_history_control(self):
        html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
        script = (ROOT / 'static/app.js').read_text(encoding='utf-8')
        self.assertIn('id="clear-batches"', html)
        self.assertIn('清空记录', html)
        self.assertIn('function batchButtonLabel', script)
        self.assertIn('第${issue}期', script)
        self.assertIn('function clearBatches()', script)
        self.assertIn('function removeBatch', script)
        self.assertIn("remove.textContent = 'x'", script)
        self.assertIn("$('clear-batches').addEventListener('click', clearBatches)", script)
        self.assertNotIn('window.confirm', script)

    def test_recent_batch_period_uses_next_issue(self):
        script = (ROOT / 'static/app.js').read_text(encoding='utf-8')
        self.assertIn('function nextIssue', script)
        self.assertIn('String(value + 1)', script)

    def test_prize_check_waits_for_target_issue_and_displays_amount(self):
        script = (ROOT / 'static/app.js').read_text(encoding='utf-8')
        self.assertIn('function targetIssue', script)
        self.assertIn('function isIssueDrawn', script)
        self.assertIn('待开奖', script)
        self.assertIn('等待开奖', script)
        self.assertIn('prize_display', script)
        self.assertIn('fixed_prize_total', script)
        self.assertIn('const issue = targetIssue(current)', script)

    def test_refresh_interval_is_fixed_in_the_page(self):
        html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
        script = (ROOT / 'static/app.js').read_text(encoding='utf-8')
        self.assertNotIn('<select id="interval"', html)
        self.assertIn('每 12 小时', html)
        self.assertNotIn("$('interval').addEventListener", script)

    def test_each_ticket_has_independent_reroll_control(self):
        script = (ROOT / 'static/app.js').read_text(encoding='utf-8')
        self.assertIn('重摇', script)
        self.assertIn('function rerollTicket', script)
        self.assertIn("api('api/reroll'", script)
        self.assertNotIn("api('/api/reroll'", script)
        self.assertIn('batch.tickets[index] = result.ticket', script)
        self.assertNotIn("copy.className = 'row-copy'", script)


if __name__ == '__main__':
    unittest.main()
