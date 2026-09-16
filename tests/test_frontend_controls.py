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

    def test_trial_entry_and_simulation_page_are_wired(self):
        index = (ROOT / 'static/index.html').read_text(encoding='utf-8')
        page = (ROOT / 'static/trial.html').read_text(encoding='utf-8')
        script = (ROOT / 'static/trial.js').read_text(encoding='utf-8')
        self.assertIn('id="trial"', index)
        self.assertIn('试命', index)
        self.assertIn('id="trial-float"', index)
        self.assertIn('trial-float-pinned', (ROOT / 'static/app.js').read_text(encoding='utf-8'))
        self.assertIn('trial-float-hidden', (ROOT / 'static/style.css').read_text(encoding='utf-8'))
        self.assertIn('id="trial-toggle"', page)
        self.assertNotIn('id="trial-stop"', page)
        self.assertIn('id="trial-periods"', page)
        self.assertIn('id="trial-years"', page)
        self.assertIn('id="trial-cost"', page)
        self.assertIn('value="weighted"', page)
        self.assertIn('id="trial-speed"', page)
        self.assertIn('<option value="80">慢</option>', page)
        self.assertIn('<option value="250">中</option>', page)
        self.assertIn('<option value="700">快</option>', page)
        self.assertIn('<option value="10000" selected>瞬间</option>', page)
        self.assertIn("api('api/state')", script)
        self.assertIn("api('api/weights?strength=5')", script)
        self.assertIn('crypto.getRandomValues', script)
        self.assertIn('TRIAL_ATTEMPTS_PER_FRAME', script)
        self.assertIn('function weightedPick', script)
        self.assertIn('function toggleTrial', script)
        self.assertIn('权重读取失败', script)
        self.assertIn('function stopTrial', script)
        self.assertIn('trial-periods', script)
        self.assertIn('trial-years', script)
        self.assertIn('trial-cost', script)
        self.assertIn('id="trial-prizes"', page)
        for level in range(2, 7):
            self.assertIn(f'id="trial-prize-{level}"', page)
        self.assertIn('function evaluateTrialPrize', script)
        self.assertIn('prizeCounts[level] += 1', script)
        self.assertIn('function updatePrizeStats', script)
        self.assertIn('命中', script)


if __name__ == '__main__':
    unittest.main()
