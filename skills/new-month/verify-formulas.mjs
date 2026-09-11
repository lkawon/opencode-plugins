import {createSheetsApi} from './auth.mjs';

const range = process.argv[2];
if (!range) {
  console.log('Usage: node verify-formulas.mjs Sheet!A1:C10');
  process.exit(1);
}

const {api, spreadsheetId: SPREADSHEET_ID} = createSheetsApi();

const {data} = await api.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range,
  valueRenderOption: 'FORMULA',
});
console.log(JSON.stringify({range, formulas: data.values ?? []}, null, 2));
