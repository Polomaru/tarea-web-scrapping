import fs from "fs";
import { randomUUID } from "crypto";
import AWS from "aws-sdk";
import chromium from "chrome-aws-lambda";
import puppeteer from "puppeteer-core";

// DynamoDB DocumentClient
const dynamodb = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event) => {
  // 1) Launch headless Chrome
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  const url = 'https://ultimosismo.igp.gob.pe/ultimo-sismo/sismos-reportados';
  const selector = 'table.table.table-hover.table-bordered.table-light.border-white.w-100';

  // 2) Navigate and wait
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector(selector, { timeout: 15000 });

  // 3) Scrape table data
  const data = await page.$$eval(
    `${selector} tbody tr`,
    (rows, sel) => {
      const table = document.querySelector(sel);
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
      return rows.map((tr, idx) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cells[i]?.textContent.trim() || ''; });
        obj['#'] = idx + 1;
        return obj;
      });
    },
    selector
  );

  await browser.close();

  // 4) Clear existing items
  const existing = await dynamodb.scan({ TableName: TABLE_NAME }).promise();
  if (existing.Items && existing.Items.length) {
    const batches = [];
    for (let i = 0; i < existing.Items.length; i += 25) {
      batches.push(existing.Items.slice(i, i + 25).map(item => ({ DeleteRequest: { Key: { id: item.id } } })));  
    }
    for (const batch of batches) {
      await dynamodb.batchWrite({ RequestItems: { [TABLE_NAME]: batch } }).promise();
    }
  }

  // 5) Insert new data
  const putBatches = [];
  for (let i = 0; i < data.length; i += 25) {
    putBatches.push(data.slice(i, i + 25).map(item => ({ PutRequest: { Item: { ...item, id: randomUUID() } } }));
  }
  for (const batch of putBatches) {
    await dynamodb.batchWrite({ RequestItems: { [TABLE_NAME]: batch } }).promise();
  }

  // 6) Return scraped data
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(data.map((item, idx) => ({ ...item, id: randomUUID(), '#': idx + 1 }))),
  };
};
