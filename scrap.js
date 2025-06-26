const AWS = require('aws-sdk');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const { randomUUID } = require('crypto');

// Configurar DynamoDB DocumentClient
const dynamodb = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

module.exports.handler = async (event, context) => {
  // 1) Lanzar Chrome headless via chrome-aws-lambda
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  const url = 'https://ultimosismo.igp.gob.pe/ultimo-sismo/sismos-reportados';
  const selector = 'table.table.table-hover.table-bordered.table-light.border-white.w-100';

  // 2) Cargar página y esperar tabla
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector(selector, { timeout: 15000 });

  // 3) Extraer datos de la tabla
  const data = await page.$$eval(
    `${selector} tbody tr`,
    (rows, sel) => {
      const table = document.querySelector(sel);
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
      return rows.map((tr, idx) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (cells[i]?.textContent.trim() || ''); });
        obj['#'] = idx + 1;
        obj['id'] = crypto.randomUUID();
        return obj;
      });
    },
    selector
  );
  await browser.close();

  // 4) Limpiar DynamoDB existente
  const existing = await dynamodb.scan({ TableName: TABLE_NAME }).promise();
  if (existing.Items && existing.Items.length) {
    const deletes = existing.Items.map(item => ({ DeleteRequest: { Key: { id: item.id } } }));
    for (let i = 0; i < deletes.length; i += 25) {
      const batch = deletes.slice(i, i + 25);
      await dynamodb.batchWrite({ RequestItems: { [TABLE_NAME]: batch } }).promise();
    }
  }

  // 5) Insertar nuevos datos en lotes de 25
  for (let i = 0; i < data.length; i += 25) {
    const batch = data.slice(i, i + 25).map(item => ({ PutRequest: { Item: item } }));
    await dynamodb.batchWrite({ RequestItems: { [TABLE_NAME]: batch } }).promise();
  }

  // 6) Retornar datos en la respuesta
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(data)
  };
};
