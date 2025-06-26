// scrap.js
const chromium = require("chrome-aws-lambda");
const puppeteer = require("puppeteer-core");
const { randomUUID } = require("crypto");
const AWS = require("aws-sdk");

const ddb = new AWS.DynamoDB.DocumentClient();
const TABLE = process.env.TABLE_NAME;

module.exports.handler = async function(event, context) {
  // 1) Lanzar Chromium empaquetado con chrome-aws-lambda
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });

  try {
    const url =
      "https://ultimosismo.igp.gob.pe/ultimo-sismo/sismos-reportados";
    const selector =
      "table.table.table-hover.table-bordered.table-light.border-white.w-100";

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector(selector, { timeout: 10000 });

    // 2) Scrape: extraer cabeceras y filas
    const data = await page.$$eval(
      `${selector} tbody tr`,
      (rows, sel) => {
        const tbl = document.querySelector(sel);
        const headers = Array.from(tbl.querySelectorAll("thead th")).map((th) =>
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

    // 3) Cerrar browser
    await browser.close();

    // 4) Añadir ID único y preparar batchWrite para DynamoDB
    const putRequests = data.map((item) => ({
      PutRequest: {
        Item: {
          ...item,
          id: randomUUID(),
        },
      },
    }));

    // 5) Limpiar tabla (opcional) y escribir nuevos items en lotes de 25
    while (putRequests.length) {
      const batch = putRequests.splice(0, 25);
      await ddb
        .batchWrite({
          RequestItems: {
            [TABLE]: batch,
          },
        })
        .promise();
    }

    // 6) Devolver las filas raw en el body
    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json" },
    };
  } catch (err) {
    await browser.close();
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: err.message }),
    };
  }
};
