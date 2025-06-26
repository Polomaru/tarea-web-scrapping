import requests
from bs4 import BeautifulSoup
import boto3
import uuid

def lambda_handler(event, context):
    # 1) Nueva URL de listados de sismos
    url = "https://ultimosismo.igp.gob.pe/ultimo-sismo/sismos-reportados"
    response = requests.get(url)
    if response.status_code != 200:
        return {'statusCode': response.status_code, 'body': 'Error al acceder a la página'}

    # 2) Parsear y localizar la tabla de sismos
    soup = BeautifulSoup(response.content, 'html.parser')
    # Ajusta el selector si la tabla tiene clase o id diferente:
    table = soup.find('table')  
    if not table:
        return {'statusCode': 404, 'body': 'No se encontró la tabla de sismos'}

    # 3) Extraer encabezados desde thead
    headers = [th.text.strip() for th in table.thead.find_all('th')]

    # 4) Extraer filas desde tbody
    rows = []
    for tr in table.tbody.find_all('tr'):
        cols = [td.text.strip() for td in tr.find_all('td')]
        # Mapear cada encabezado con su celda
        record = { headers[i]: cols[i] for i in range(len(cols)) }
        rows.append(record)

    # 5) Guardar en DynamoDB (idéntico a tu lógica anterior)
    dynamodb = boto3.resource('dynamodb')
    tbl = dynamodb.Table('TareaWebScrapping')
    # Vaciar tabla
    scan = tbl.scan()
    with tbl.batch_writer() as batch:
        for item in scan.get('Items', []):
            batch.delete_item(Key={'id': item['id']})
    # Insertar nuevos registros con UUID
    for idx, row in enumerate(rows, start=1):
        row['#'] = idx
        row['id'] = str(uuid.uuid4())
        tbl.put_item(Item=row)

    return {'statusCode': 200, 'body': rows}
