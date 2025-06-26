import AWS from 'aws-sdk';
import puppeteer from 'puppeteer-core';

// Configurar DynamoDB DocumentClient (usa región de entorno de Lambda)
const dynamodb = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async () => {
  // 1) Lanzar Puppeteer usando chrome-aws-lambda en Lambda
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.LAMBDA_TASK_ROOT
      ? '/opt/headless-chromium'
      : '/usr/bin/chromium-browser',
    headless: true,
  });
  const page = await browser.newPage();
  const url = 'https://ultimosismo.igp.gob.pe/ultimo-sismo/sismos-reportados';
  const selector = 'table.table.table-hover.table-bordered.table-light.border-white.w-100';

  // 2) Navegar y esperar la tabla
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector(selector, { timeout: 15000 });

  // 3) Extraer datos del DOM
  const rows = await page.$$eval(
    `${selector} tbody tr`,
    (trs, sel) => {
      const tbl = document.querySelector(sel);
      const headers = Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent.trim());
      return trs.map((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = cells[idx]?.textContent.trim() || '';
        });
        obj['#'] = i + 1;
        obj['id'] = crypto.randomUUID();
        return obj;
      });
    },
    selector
  );
  await browser.close();

  // 4) Limpiar DynamoDB actual
  const existing = await dynamodb.scan({ TableName: TABLE_NAME }).promise();
  if (existing.Items && existing.Items.length) {
    const deletes = existing.Items.map(item => ({ DeleteRequest: { Key: { id: item.id } } }));
    for (let i = 0; i < deletes.length; i += 25) {
      const batch = deletes.slice(i, i + 25);
      await dynamodb.batchWrite({ RequestItems: { [TABLE_NAME]: batch } }).promise();
    }
  }

  // 5) Guardar nuevos datos en DynamoDB en lotes de 25
  const puts = rows.map(item => ({ PutRequest: { Item: item } }));
  for (let i = 0; i < puts.length; i += 25) {
    const batch = puts.slice(i, i + 25);
    await dynamodb.batchWrite({ RequestItems: { [TABLE_NAME]: batch } }).promise();
  }

  // 6) Retornar en el response
  return {
    statusCode: 200,
    body: JSON.stringify(rows),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  };
};
