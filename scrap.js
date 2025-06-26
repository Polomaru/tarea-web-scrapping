// scrap.js
const fs = require("fs");
const { randomUUID } = require("crypto");
const chromium = require("chrome-aws-lambda"); // layer chrome-aws-lambda
const puppeteer = require("puppeteer-core");    // usar chrome-aws-lambda + puppeteer-core

module.exports.handler = async function(event, context) {
  const url = "https://ultimosismo.igp.gob.pe/ultimo-sismo/sismos-reportados";
  const selector = "table.table.table-hover.table-bordered.table-light.border-white.w-100";

  // Lanzar Puppeteer apuntando al binario de chrome-aws-lambda
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector(selector, { timeout: 10000 });

  // Extraer datos
  const data = await page.$$eval(
    `${selector} tbody tr`,
    (rows, sel) => {
      const tbl = document.querySelector(sel);
      const headers = Array.from(tbl.querySelectorAll("thead th")).map(th =>
        th.textContent.trim()
      );
      return rows.map((tr, idx) => {
        const cells = Array.from(tr.querySelectorAll("td"));
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cells[i]?.textContent.trim() ?? "";
        });
        obj["#"] = idx + 1;
        return obj;
      });
    },
    selector
  );

  await browser.close();

  // Agregar ID y volcar a DynamoDB
  const AWS = require("aws-sdk");
  const dynamo = new AWS.DynamoDB.DocumentClient();
  const tableName = process.env.TABLE_NAME;
  const putRequests = data.map(item => ({
    PutRequest: {
      Item: Object.assign(item, { id: randomUUID() })
    }
  }));

  // Limpia tabla (opcional: si quieres borrar todo primero haz un scan+batchWrite de DeleteRequest)
  // Aquí simplemente reescribimos en lotes de 25:
  while (putRequests.length) {
    const batch = putRequests.splice(0, 25);
    await dynamo.batchWrite({
      RequestItems: { [tableName]: batch }
    }).promise();
  }

  return {
    statusCode: 200,
    body: JSON.stringify(data)
  };
};
