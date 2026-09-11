import {createSheetsApi} from './auth.mjs';

const DATA_START_ROW = 4; // Zero-based; dates begin in row 5.
const FORMAT_COLUMN_END = 26;
const MONTH_NAMES = [
  'STYCZE\u0143',
  'LUTY',
  'MARZEC',
  'KWIECIE\u0143',
  'MAJ',
  'CZERWIEC',
  'LIPIEC',
  'SIERPIE\u0143',
  'WRZESIE\u0143',
  'PA\u0179DZIERNIK',
  'LISTOPAD',
  'GRUDZIE\u0143',
];

const args = process.argv.slice(2);
if (args.includes('--help') || !args.some(arg => /^\d{2}\.\d{4}$/.test(arg))) {
  console.log('Usage: node new-month.mjs MM.YYYY [--source MM.YYYY] [--dry-run]');
  process.exit(args.includes('--help') ? 0 : 1);
}

const targetTitle = args.find(arg => /^\d{2}\.\d{4}$/.test(arg));
const sourceFlagIndex = args.indexOf('--source');
const dryRun = args.includes('--dry-run');

function parseMonth(title) {
  const match = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(title);
  if (!match) throw new Error(`Invalid month: ${title}. Expected MM.YYYY.`);
  return {month: Number(match[1]), year: Number(match[2])};
}

function previousMonth({month, year}) {
  return month === 1
    ? {month: 12, year: year - 1}
    : {month: month - 1, year};
}

function monthTitle({month, year}) {
  return `${String(month).padStart(2, '0')}.${year}`;
}

function daysInMonth({month, year}) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstDayWithType(monthData, predicate) {
  const days = daysInMonth(monthData);
  for (let day = 1; day <= days; day++) {
    const weekday = new Date(Date.UTC(monthData.year, monthData.month - 1, day)).getUTCDay();
    if (predicate(weekday)) return day;
  }
  throw new Error('Could not find a format sample row.');
}

function sheetsDateSerial(year, month, day) {
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
}

const targetMonth = parseMonth(targetTitle);
const sourceTitle = sourceFlagIndex >= 0
  ? args[sourceFlagIndex + 1]
  : monthTitle(previousMonth(targetMonth));
if (!sourceTitle) throw new Error('--source requires MM.YYYY.');
const sourceMonth = parseMonth(sourceTitle);
const sourceDays = daysInMonth(sourceMonth);
const targetDays = daysInMonth(targetMonth);

const saturdays = [];
const sundays = [];
for (let day = 1; day <= targetDays; day++) {
  const weekday = new Date(Date.UTC(targetMonth.year, targetMonth.month - 1, day)).getUTCDay();
  if (weekday === 6) saturdays.push(day);
  if (weekday === 0) sundays.push(day);
}

const saturdaySampleRow = DATA_START_ROW + firstDayWithType(sourceMonth, day => day === 6) - 1;
const sundaySampleRow = DATA_START_ROW + firstDayWithType(sourceMonth, day => day === 0) - 1;
const weekdaySampleRow = DATA_START_ROW + firstDayWithType(sourceMonth, day => day >= 1 && day <= 5) - 1;

const {api, spreadsheetId: SPREADSHEET_ID} = createSheetsApi();

const {data} = await api.spreadsheets.get({
  spreadsheetId: SPREADSHEET_ID,
  fields: 'sheets.properties',
});
const source = data.sheets.find(sheet => sheet.properties.title === sourceTitle)?.properties;
if (!source) throw new Error(`Source sheet ${sourceTitle} does not exist.`);
if (data.sheets.some(sheet => sheet.properties.title === targetTitle)) {
  throw new Error(`Target sheet ${targetTitle} already exists; stopped without changes.`);
}

console.log([
  `${sourceTitle} -> ${targetTitle}`,
  `${sourceDays} -> ${targetDays} days`,
  `Saturdays: ${saturdays.join(', ')}`,
  `Sundays: ${sundays.join(', ')}`,
].join('\n'));
if (dryRun) process.exit(0);

let targetSheetId;
try {
  const duplicate = await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {requests: [{
      duplicateSheet: {
        sourceSheetId: source.sheetId,
        newSheetName: targetTitle,
        insertSheetIndex: data.sheets.length,
      },
    }]},
  });
  targetSheetId = duplicate.data.replies[0].duplicateSheet.properties.sheetId;

  const requests = [];
  if (targetDays > sourceDays) {
    requests.push({insertDimension: {
      range: {
        sheetId: targetSheetId,
        dimension: 'ROWS',
        startIndex: DATA_START_ROW + sourceDays,
        endIndex: DATA_START_ROW + targetDays,
      },
      inheritFromBefore: true,
    }});
  } else if (targetDays < sourceDays) {
    requests.push({deleteDimension: {range: {
      sheetId: targetSheetId,
      dimension: 'ROWS',
      startIndex: DATA_START_ROW + targetDays,
      endIndex: DATA_START_ROW + sourceDays,
    }}});
  }

  requests.push(
    {updateCells: {
      range: {
        sheetId: targetSheetId,
        startRowIndex: 2,
        endRowIndex: 3,
        startColumnIndex: 1,
        endColumnIndex: 2,
      },
      rows: [{values: [{userEnteredValue: {stringValue: MONTH_NAMES[targetMonth.month - 1]}}]}],
      fields: 'userEnteredValue',
    }},
    {updateCells: {
      range: {
        sheetId: targetSheetId,
        startRowIndex: DATA_START_ROW,
        endRowIndex: DATA_START_ROW + targetDays,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      rows: Array.from({length: targetDays}, (_, index) => ({values: [{
        userEnteredValue: {
          numberValue: sheetsDateSerial(targetMonth.year, targetMonth.month, index + 1),
        },
      }]})),
      fields: 'userEnteredValue',
    }},
    {repeatCell: {
      range: {
        sheetId: targetSheetId,
        startRowIndex: DATA_START_ROW,
        endRowIndex: DATA_START_ROW + targetDays,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: {userEnteredFormat: {numberFormat: {type: 'DATE', pattern: 'dd-mm-yyyy'}}},
      fields: 'userEnteredFormat.numberFormat',
    }},
    {updateCells: {
      range: {
        sheetId: targetSheetId,
        startRowIndex: DATA_START_ROW,
        endRowIndex: DATA_START_ROW + targetDays,
        startColumnIndex: 2,
        endColumnIndex: 3,
      },
      rows: Array.from({length: targetDays}, (_, index) => ({values: [{
        userEnteredValue: {
          formulaValue: index === 0
            ? `=B${DATA_START_ROW + 1}+0`
            : `=B${DATA_START_ROW + 1 + index}+C${DATA_START_ROW + index}`,
        },
      }]})),
      fields: 'userEnteredValue',
    }},
  );

  const formatRequest = (sourceRow, destinationRow) => ({copyPaste: {
    source: {
      sheetId: source.sheetId,
      startRowIndex: sourceRow,
      endRowIndex: sourceRow + 1,
      startColumnIndex: 0,
      endColumnIndex: FORMAT_COLUMN_END,
    },
    destination: {
      sheetId: targetSheetId,
      startRowIndex: destinationRow,
      endRowIndex: destinationRow + 1,
      startColumnIndex: 0,
      endColumnIndex: FORMAT_COLUMN_END,
    },
    pasteType: 'PASTE_FORMAT',
    pasteOrientation: 'NORMAL',
  }});

  for (let day = 1; day <= targetDays; day++) {
    requests.push(formatRequest(weekdaySampleRow, DATA_START_ROW + day - 1));
  }
  for (const day of saturdays) {
    requests.push(formatRequest(saturdaySampleRow, DATA_START_ROW + day - 1));
  }
  for (const day of sundays) {
    requests.push(formatRequest(sundaySampleRow, DATA_START_ROW + day - 1));
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {requests},
  });
  await api.spreadsheets.values.batchClear({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {ranges: [
      `'${targetTitle}'!B5:B${DATA_START_ROW + targetDays}`,
      `'${targetTitle}'!D5:D${DATA_START_ROW + targetDays}`,
    ]},
  });

  const verification = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${targetTitle}'!A3:D${DATA_START_ROW + targetDays}`,
    valueRenderOption: 'FORMULA',
  });
   const rows = verification.data.values ?? [];
   if (rows.length < targetDays + 2) throw new Error('Verification returned too few rows.');
   const firstFormula = rows[2]?.[2];
   const lastFormula = rows[rows.length - 1]?.[2];
   if (firstFormula !== `=B${DATA_START_ROW + 1}+0`) {
     throw new Error(`Unexpected first C formula: ${firstFormula}`);
   }
   if (lastFormula !== `=B${DATA_START_ROW + targetDays}+C${DATA_START_ROW + targetDays - 1}`) {
     throw new Error(`Unexpected last C formula: ${lastFormula}`);
   }
   console.log(`Created and verified ${targetTitle}.`);
} catch (error) {
  if (targetSheetId) {
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {requests: [{deleteSheet: {sheetId: targetSheetId}}]},
      });
      console.error(`Rolled back incomplete sheet ${targetTitle}.`);
    } catch (rollbackError) {
      console.error(`Rollback failed: ${rollbackError.message}`);
    }
  }
  throw error;
}
