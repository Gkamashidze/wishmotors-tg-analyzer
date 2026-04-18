import { test, expect } from '@playwright/test';

test('products table rows are numbered 1,2,3...', async ({ page }) => {
  await page.goto('http://localhost:3000/products');
  await page.waitForSelector('table tbody tr', { timeout: 10000 });

  const rows = await page.evaluate(() => {
    const trs = document.querySelectorAll('table tbody tr');
    return Array.from(trs).map((tr, i) => {
      const cells = tr.querySelectorAll('td');
      return {
        rowIndex: i + 1,
        displayedNum: cells[0]?.textContent?.trim() ?? '',
        name: cells[2]?.textContent?.trim() ?? '',
      };
    });
  });

  console.log('\n=== Products Table Numbering ===');
  rows.slice(0, 15).forEach(r => {
    const ok = r.displayedNum === String(r.rowIndex);
    console.log(`${ok ? '✅' : '❌'} Row ${r.rowIndex}: shown="${r.displayedNum}" | "${r.name}"`);
  });

  for (const row of rows) {
    expect(row.displayedNum, `Row ${row.rowIndex} (${row.name}) must show ${row.rowIndex}`).toBe(String(row.rowIndex));
  }
});
