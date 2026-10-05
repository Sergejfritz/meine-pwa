const { test, expect } = require('@playwright/test');

async function hold(page) {
  const card = page.locator('#flipCard');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(card).toHaveClass(/open/);
  const text = await page.locator('#cardBack').innerText();
  await page.mouse.up();
  return text;
}

test('Imposter: komplette Runde spielen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/imposter/index.html');
  await page.click('#splash');
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.click('#btnNew');
  await page.fill('#playerInput', 'Anna');
  await page.press('#playerInput', 'Enter');
  await expect(page.locator('#playerList li')).toHaveCount(5);
  await page.click('[data-mode=hint]');
  await page.click('#btnStart');

  const cards = [];
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('#btnNextPlayer')).toBeDisabled();
    cards.push(await hold(page));
    await page.click('#btnNextPlayer');
  }
  expect(cards.filter((c) => c.includes('IMPOSTER'))).toHaveLength(1);
  await expect(page.locator('#s-discuss')).toBeVisible();
  await page.click('#btnToVote');
  await page.locator('#voteGrid .vote-btn').first().click();
  await page.click('#btnVote');
  // entweder Rate-Bildschirm oder Ergebnis
  if (await page.locator('#s-guess').isVisible()) await page.locator('#guessGrid .vote-btn').first().click();
  await expect(page.locator('#s-result')).toBeVisible();
  await expect(page.locator('#scoreList li')).toHaveCount(5);
  await page.screenshot({ path: process.env.SHOT || 'test-results/imposter.png' });
  expect(errors).toEqual([]);
});
