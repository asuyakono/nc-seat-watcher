// 新中央航空(NC) 空席ウォッチャー
// 予約サイトの空席照会フローをヘッドレスで実行し、満席→空席の変化を検出してSlackへ通知する。
// 予約や決済は一切行わない（検索のみ）。

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const BOOKING_URL = 'https://ncprod.ibsplc.aero/reservation/ibe/booking?execution=e1s1&locale=ja';
const AIRPORTS = { CHU: '調布', KAZ: '神津島', MYE: '三宅島', NJM: '新島', OIM: '大島' };
const STATE_FILE = 'state.json';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const normNo = (s) => (s || '').replace(/\s+/g, '').toUpperCase(); // "NC 101" -> "NC101"

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// フォームを入力して空席照会を実行し、結果ページの便一覧を返す。
async function searchFlights(context, w) {
  const page = await context.newPage();
  try {
    await page.goto(BOOKING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 出発地の選択肢が描画されるまで待つ（非表示のためstate:attachedで待機）
    await page.waitForSelector(`#aiRESOrigin0 option[value="${w.origin}"]`, {
      state: 'attached',
      timeout: 30000,
    });

    const fill = await page.evaluate((cfg) => {
      // このサイトはChosenプラグインで<select>を非表示化しており、value代入では
      // 選択が反映されないことがある。selectedIndexを直接指定し、changeを発火して
      // サイト側ハンドラ(originChange等)に到着地リストを再構築させる。
      const pickByVal = (id, val) => {
        const s = document.getElementById(id);
        if (!s) return `no ${id}`;
        const i = [...s.options].findIndex((o) => o.value === val);
        if (i < 0) return `noopt ${id}:${val}`;
        s.selectedIndex = i;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return s.value;
      };
      const trip = document.getElementById(cfg.tripType === 'RT' ? 'rtTripId' : 'owTripId');
      if (trip) { trip.checked = true; trip.click && trip.click(); }
      const o = pickByVal('aiRESOrigin0', cfg.origin); // change→到着地リスト再構築
      const d = pickByVal('aiRESDestination0', cfg.destination);
      pickByVal('aiRESAdult', String(cfg.adults ?? 1));
      pickByVal('aiRESChild', String(cfg.children ?? 0));
      pickByVal('aiRESInfant', String(cfg.infants ?? 0));
      const setDate = (id, v) => {
        const e = document.getElementById(id);
        if (e) { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      setDate('search-date-outward', cfg.date);
      if (cfg.tripType === 'RT' && cfg.returnDate) setDate('search-date-return', cfg.returnDate);
      return { o, d };
    }, w);

    if (String(fill.o).startsWith('no') || String(fill.d).startsWith('no')) {
      return { error: `フォーム入力に失敗 (origin=${fill.o}, destination=${fill.d})`, flights: [] };
    }

    await page.evaluate(() => doSearchSubmit('/reservation', 'ja', true));

    // 結果（便一覧 or 「該当便なし」メッセージ）が出るまで待つ
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return document.querySelector('.flight') ||
        t.includes('指定された検索条件に合うフライトはありません') ||
        t.includes('過去の日付で空席照会をすることはできません');
    }, { timeout: 45000 });

    const result = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      if (bodyText.includes('過去の日付で空席照会をすることはできません')) {
        return { error: '過去の日付です', flights: [] };
      }
      const flights = [...document.querySelectorAll('.flight')].map((f) => {
        const noEl = [...f.querySelectorAll('*')].find(
          (x) => /^NC ?\d+$/.test(x.textContent.trim()) && x.children.length === 0
        );
        const times = [...f.querySelectorAll('*')]
          .filter((x) => /^\d{2}:\d{2}$/.test(x.textContent.trim()) && x.children.length === 0)
          .map((x) => x.textContent.trim());
        return {
          no: noEl ? noEl.textContent.trim() : '?',
          depTime: times[0] || '',
          arrTime: times[1] || '',
          soldOut: f.classList.contains('sold-out'),
        };
      });
      return { error: null, flights };
    });

    return result;
  } finally {
    await page.close();
  }
}

async function notifySlack(text) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[SLACK未設定] ' + text.replace(/\n/g, ' '));
    return;
  }
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) console.error('Slack通知失敗:', res.status, await res.text());
}

async function main() {
  const config = await loadJson('config.json', { watches: [] });
  const state = await loadJson(STATE_FILE, {});
  const watches = config.watches || [];
  if (!watches.length) {
    console.log('config.json に監視対象がありません');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ja-JP',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const notifications = [];

  for (const w of watches) {
    const route = `${AIRPORTS[w.origin] || w.origin} (${w.origin}) → ${AIRPORTS[w.destination] || w.destination} (${w.destination})`;
    let result;
    try {
      result = await searchFlights(context, w);
    } catch (e) {
      console.error(`[${w.id}] 検索失敗:`, e.message);
      continue;
    }
    if (result.error) {
      console.error(`[${w.id}] ${result.error}`);
      continue;
    }

    const wanted = (w.flights || []).map(normNo);
    let flights = result.flights;
    if (wanted.length) flights = flights.filter((f) => wanted.includes(normNo(f.no)));

    console.log(
      `[${w.id}] ${route} ${w.date}: ` +
        (flights.map((f) => `${f.no}${f.soldOut ? '満席' : '空席'}`).join(' ') || '該当便なし')
    );

    for (const f of flights) {
      const key = `${w.id}::${normNo(f.no)}`;
      const curr = f.soldOut ? 'sold-out' : 'available';
      const prev = state[key];
      const timeStr = f.depTime ? ` ${f.depTime}発${f.arrTime ? '→' + f.arrTime + '着' : ''}` : '';

      if (curr === 'available' && prev !== 'available') {
        notifications.push(
          `🟢 *空席が出ました*\n${route}\n${w.date}  ${f.no}${timeStr}\n<https://www.central-air.co.jp/|新中央航空で予約する>`
        );
      } else if (curr === 'sold-out' && prev === 'available' && w.notifyOnClose) {
        notifications.push(`🔴 満席になりました\n${route}\n${w.date}  ${f.no}${timeStr}`);
      }
      state[key] = curr;
    }
  }

  await browser.close();

  for (const text of notifications) {
    await notifySlack(text);
  }
  console.log(`通知 ${notifications.length} 件`);

  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
