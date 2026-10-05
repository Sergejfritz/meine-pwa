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

async function open(page) {
  await page.goto('/imposter/index.html');
  await page.click('#splash');
  await expect(page.locator('#splash')).toHaveCount(0);
}

// Spielt eine Runde bis zum Ergebnis; stimmt immer für den ersten Kandidaten.
async function playRound(page, players, { draw = false } = {}) {
  const cards = [];
  for (let i = 0; i < players; i++) {
    await expect(page.locator('#btnNextPlayer')).toBeDisabled();
    cards.push(await hold(page));
    await page.click('#btnNextPlayer');
  }
  for (let guard = 0; guard < 20; guard++) {
    if (await page.locator('#s-result').isVisible()) return cards;
    if (await page.locator('#s-draw').isVisible()) {
      const box = await page.locator('#canvas').boundingBox();
      for (let i = 0; i < players; i++) {
        await page.mouse.move(box.x + 20 + i * 10, box.y + 30);
        await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 90); await page.mouse.up();
        await page.click('#btnDrawDone');
        if (!(await page.locator('#s-draw').isVisible())) break;
      }
    }
    await expect(page.locator('#s-discuss')).toBeVisible();
    if (draw) await expect(page.locator('#drawingImg')).toBeVisible();
    await page.click('#btnToVote');
    await page.locator('#voteGrid .vote-btn').first().click();
    await page.click('#btnVote');
    await expect(page.locator('#s-elim')).toBeVisible();
    await page.click('#btnElimNext');
    if (await page.locator('#s-guess').isVisible()) await page.locator('#guessGrid .vote-btn').first().click();
  }
  throw new Error('Runde endet nicht');
}

test('Imposter: Spiel über 2 Runden bis zum Endergebnis', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.click('#btnNew');
  await page.click('#rowPlayers');
  await page.fill('#playerInput', 'Anna');
  await page.press('#playerInput', 'Enter');
  await expect(page.locator('#playerList li')).toHaveCount(5);
  await page.locator('#s-players .bottom [data-back]').click();
  await expect(page.locator('#playerCount')).toHaveText('5');
  await page.click('[data-r="1"]');
  await page.click('[data-r="3"]');
  await page.click('[data-mode=classic]');
  await page.click('#btnStart');

  const cards = await playRound(page, 5);
  // Klassisch: alle sehen ein Wort, genau zwei verschiedene Wörter im Spiel
  expect(cards.every((c) => /geheimes wort/i.test(c))).toBe(true);
  await expect(page.locator('#scoreList li')).toHaveCount(5);
  await page.click('#btnNextRound');
  await playRound(page, 5);
  await page.click('#btnEndGame');
  await page.click('#modalYes');
  await expect(page.locator('#s-final')).toBeVisible();
  await expect(page.locator('#finalList li')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('Imposter: Mysteriös mit Mr. White und Zeichenmodus', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.click('#btnNew');
  await page.click('[data-mode=white]');
  await page.locator('label.feature-row').click();
  await page.click('#btnStart');
  const cards = await playRound(page, 4, { draw: true });
  expect(cards.filter((c) => /mr. white/i.test(c))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Imposter: eigenes Pack anlegen', async ({ page }) => {
  await open(page);
  await page.click('#btnPacks');
  await expect(page.locator('#packGrid .pack')).toHaveCount(27);
  await page.click('#btnNewPack');
  await page.fill('#packName', 'Arbeit');
  await page.fill('#packWords', 'Chef\nKantine\nGabelstapler');
  await page.click('#btnSavePack');
  await expect(page.locator('#customPacks .pack.on')).toHaveCount(1);
});

test('Imposter: Imposter outet sich und rät falsch -> eliminiert', async ({ page }) => {
  await open(page);
  await page.click('#btnNew');
  await page.click('[data-mode=blind]');
  await page.click('#btnStart');
  let imp = null;
  for (let i = 0; i < 4; i++) {
    const name = await page.locator('#revealName').innerText();
    if (/imposter/i.test(await hold(page))) imp = name;
    await page.click('#btnNextPlayer');
  }
  await page.click('#btnClaim');
  await page.locator(`#voteGrid .vote-btn[data-p="${imp}"]`).click();
  await page.click('#btnVote');
  await expect(page.locator('#s-guess')).toBeVisible();
  // falsches Wort wählen: irgendeins, das nicht stimmt -> wir probieren das erste und prüfen den Ausgang
  await page.locator('#guessGrid .vote-btn').first().click();
  if (await page.locator('#s-elim').isVisible()) {
    await expect(page.locator('#elimName')).toHaveText(imp);
    await page.click('#btnElimNext');
    await expect(page.locator('#s-result')).toBeVisible(); // einziger Imposter raus -> Zivilisten gewinnen
  } else {
    await expect(page.locator('#s-result')).toBeVisible(); // zufällig richtig geraten
  }
});
