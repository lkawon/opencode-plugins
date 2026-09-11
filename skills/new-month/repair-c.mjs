import {createSheetsApi} from './auth.mjs';

const title = process.argv[2];
const days = Number(process.argv[3]);
if (!title || !days) {
  console.log('Usage: node repair-c.mjs MM.YYYY days');
  process.exit(1);
}
const DATA_START_ROW = 4;

const {api, spreadsheetId: SPREADSHEET_ID} = createSheetsApi();

const {data} = await api.spreadsheets.get({
  spreadsheetId: SPREADSHEET_ID,
  fields: 'sheets.properties',
});
const sheet = data.sheets.find(s => s.properties.title === title)?.properties;
if (!sheet) throw new Error(`Sheet ${title} not found.`);

await api.spreadsheets.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: {requests: [{updateCells: {
    range: {
      sheetId: sheet.sheetId,
      startRowIndex: DATA_START_ROW,
      endRowIndex: DATA_START_ROW + days,
      startColumnIndex: 2,
      endColumnIndex: 3,
    },
    rows: Array.from({length: days}, (_, index) => ({values: [{
      userEnteredValue: {
        formulaValue: index === 0
          ? `=B${DATA_START_ROW + 1}+0`
          : `=B${DATA_START_ROW + 1 + index}+C${DATA_START_ROW + index}`,
      },
    }]})),
    fields: 'userEnteredValue',
  }}]},
});
console.log(`Fixed C5:C${DATA_START_ROW + days} formulas in ${title}.`);
