import { LeadRecord, GoogleSheetExportResult } from '../types';
import { normalizeLinkedInUrl } from './deduplication';

const HEADERS = [
  'Full Name',                      // 0
  'LinkedIn Profile URL',           // 1
  'Job Title',                      // 2
  'Seniority',                      // 3
  'Company Name',                   // 4
  'Industry',                       // 5
  'Company Description',            // 6
  'Company Website',                // 7
  'Country',                        // 8
  'City / Region',                  // 9
  'Business Email',                 // 10
  'Business Phone',                 // 11
  'Additional Business Contact',    // 12
  'Contact Source URL',             // 13
  'Instagram ID / Username',        // 14
  'Instagram Profile URL',          // 15
  'Instagram Verification Status',  // 16
  'Other Public Social Profile URLs',// 17
  'Relevance Score',                // 18
  'Relevance Reason',               // 19
  'Verification Status',            // 20
  'Source URL',                     // 21
  'Date Added',                     // 22
  'Outreach Status',                // 23
  'Notes'                           // 24
];

/**
 * Escapes a string to prevent Google Sheets from interpreting it as a formula.
 */
function escapeValue(val: any): any {
  if (typeof val === 'string' && val.startsWith('=')) {
    return `'${val}`;
  }
  return val === null || val === undefined ? '' : val;
}

/**
 * Applies professional formatting to the Google Sheet.
 */
async function formatSpreadsheet(accessToken: string, spreadsheetId: string, sheetId: number) {
  const requests = [
    // 1. Bold and background for header row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 },
            textFormat: { bold: true, fontSize: 10 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    // 2. Freeze the first row
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    // 3. Set column widths
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 150 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 250 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 8 },
        properties: { pixelSize: 180 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 24, endIndex: 25 },
        properties: { pixelSize: 300 },
        fields: 'pixelSize'
      }
    },
    // 4. Enable text wrapping for Notes and Headline
    {
      repeatCell: {
        range: { sheetId, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat.wrapStrategy'
      }
    },
    {
      repeatCell: {
        range: { sheetId, startColumnIndex: 24, endColumnIndex: 25 },
        cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat.wrapStrategy'
      }
    },
    // 5. Enable basic filter for the entire range
    {
      setBasicFilter: {
        filter: { range: { sheetId, startRowIndex: 0 } }
      }
    }
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
}

export async function exportLeadsToGoogleSheet(
  accessToken: string,
  clientName: string,
  leads: LeadRecord[],
  existingSpreadsheetId?: string
): Promise<GoogleSheetExportResult> {
  if (!accessToken) throw new Error('Google OAuth Access Token is missing.');

  if (!leads || leads.length === 0) {
    return {
      success: false,
      spreadsheetId: existingSpreadsheetId || '',
      spreadsheetUrl: existingSpreadsheetId ? `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}` : '',
      addedCount: 0,
      skippedDuplicatesCount: 0,
      message: 'Export failed: Zero leads available or selected for export.'
    };
  }

  try {
    let spreadsheetId = existingSpreadsheetId;
    let sheetId = 0;
    let isNewSheet = false;

    // Step 1: Resolve Spreadsheet
    if (!spreadsheetId) {
      const searchTitle = `LinkedIn Leads - ${clientName}`;
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(searchTitle)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          spreadsheetId = searchData.files[0].id;
        }
      }

      if (!spreadsheetId) {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: { title: `LinkedIn Leads - ${clientName}` },
            sheets: [{ properties: { title: 'Leads' } }]
          })
        });
        if (!createRes.ok) throw new Error('Failed to create Google Sheet.');
        const createData = await createRes.json();
        spreadsheetId = createData.spreadsheetId;
        sheetId = createData.sheets[0].properties.sheetId;
        isNewSheet = true;

        // Write Headers
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A1:update?valueInputOption=RAW`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [HEADERS] })
        });
      }
    }

    // Get Sheet ID for formatting if not new
    if (!isNewSheet && spreadsheetId) {
      const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (getRes.ok) {
        const getData = await getRes.json();
        const sheet = getData.sheets.find((s: any) => s.properties.title === 'Leads') || getData.sheets[0];
        sheetId = sheet.properties.sheetId;
      }
    }

    if (!spreadsheetId) throw new Error('Unable to obtain a valid Google Spreadsheet ID.');

    // Step 2: Fetch existing rows to avoid duplicates
    let existingProfileUrls = new Set<string>();
    if (!isNewSheet) {
      const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A:B`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (readRes.ok) {
        const readData = await readRes.json();
        const rows: string[][] = readData.values || [];
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][1]) existingProfileUrls.add(normalizeLinkedInUrl(rows[i][1]));
        }
      }
    }

    // Step 3: Map and filter
    const leadsToAdd: LeadRecord[] = [];
    let skippedDuplicatesCount = 0;
    for (const lead of leads) {
      const normUrl = normalizeLinkedInUrl(lead.profileUrl);
      if (existingProfileUrls.has(normUrl)) {
        skippedDuplicatesCount++;
      } else {
        leadsToAdd.push(lead);
        existingProfileUrls.add(normUrl);
      }
    }

    // Step 4: Append Data
    if (leadsToAdd.length > 0) {
      const valueRows = leadsToAdd.map((l) => [
        escapeValue(l.fullName),                            // 0: Full Name
        escapeValue(l.linkedInProfileUrl || l.profileUrl),  // 1: LinkedIn Profile URL
        escapeValue(l.currentJobTitle),                     // 2: Job Title
        escapeValue((l as any).seniority || 'Professional'),// 3: Seniority
        escapeValue(l.companyName),                         // 4: Company Name
        escapeValue(l.businessCategory || 'B2B'),           // 5: Industry
        escapeValue(l.headline),                            // 6: Company Description
        escapeValue(l.businessWebsite || 'Unavailable'),    // 7: Company Website
        escapeValue(l.location),                            // 8: Country
        escapeValue(l.businessCity || 'Unavailable'),       // 9: City / Region
        escapeValue(l.businessEmail || 'Unavailable'),      // 10: Business Email
        escapeValue(l.businessPhone || 'Unavailable'),      // 11: Business Phone
        'N/A',                                              // 12: Additional Business Contact
        escapeValue(l.profileUrl),                          // 13: Contact Source URL (Wikidata URI)
        escapeValue(l.instagramUsername ? `@${l.instagramUsername}` : 'Unavailable'), // 14: Instagram ID
        escapeValue(l.instagramProfileUrl || 'Unavailable'),// 15: Instagram Profile URL
        escapeValue(l.instagramVerificationStatus || 'Not Checked'), // 16: Instagram Verification Status
        'N/A',                                              // 17: Other Public Social
        escapeValue(l.relevanceScore || 0),                 // 18: Relevance Score
        escapeValue(l.relevanceExplanation || 'Discovered'),// 19: Relevance Reason
        escapeValue(l.contactVerificationStatus || 'Not checked'), // 20: Verification Status
        escapeValue(l.profileUrl),                          // 21: Source URL (Wikidata URI)
        escapeValue(l.dateAdded),                           // 22: Date Added
        escapeValue(l.status),                              // 23: Outreach Status
        escapeValue(l.notes)                                // 24: Notes
      ]);

      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A1:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ range: 'Leads!A1', majorDimension: 'ROWS', values: valueRows })
        }
      );
      if (!appendRes.ok) throw new Error(`Failed to write rows: ${await appendRes.text()}`);
    }

    // Step 5: Format Spreadsheet
    await formatSpreadsheet(accessToken, spreadsheetId, sheetId);

    return {
      success: true,
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      addedCount: leadsToAdd.length,
      skippedDuplicatesCount,
      message: `Export completed — ${leadsToAdd.length} leads added.`
    };
  } catch (error: any) {
    console.error('Google Sheets export error:', error);
    throw new Error(error.message || 'Google Sheets export failed.');
  }
}

export function exportLeadsToCsv(clientName: string, leads: LeadRecord[]) {
  if (!leads || leads.length === 0) return;
  const csvRows = [
    HEADERS.join(','),
    ...leads.map((l) => {
      const row = [
        l.fullName,                            // 0
        l.linkedInProfileUrl || l.profileUrl,  // 1
        l.currentJobTitle,                     // 2
        (l as any).seniority || 'Professional',// 3
        l.companyName,                         // 4
        l.businessCategory || 'B2B',           // 5
        l.headline,                            // 6
        l.businessWebsite || '',               // 7
        l.location,                            // 8
        l.businessCity || '',                  // 9
        l.businessEmail || '',                 // 10
        l.businessPhone || '',                 // 11
        '',                                    // 12
        l.profileUrl,                          // 13: Contact Source URL (URI)
        l.instagramUsername ? `@${l.instagramUsername}` : '', // 14
        l.instagramProfileUrl || '',           // 15
        l.instagramVerificationStatus || '',   // 16
        '',                                    // 17
        l.relevanceScore || 0,                 // 18
        l.relevanceExplanation || '',          // 19
        l.contactVerificationStatus || '',     // 20
        l.profileUrl,                          // 21: Source URL (URI)
        l.dateAdded,                           // 22
        l.status,                              // 23
        l.notes                                // 24
      ];
      return row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
    })
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `leads_${clientName.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`);
  link.click();
}

export async function exportLeadsToXlsx(clientName: string, leads: LeadRecord[]) {
  const XLSX = await import('xlsx');
  const data = leads.map((l) => {
    const obj: any = {};
    const values = [
      l.fullName,                            // 0
      l.linkedInProfileUrl || l.profileUrl,  // 1
      l.currentJobTitle,                     // 2
      (l as any).seniority || 'Professional',// 3
      l.companyName,                         // 4
      l.businessCategory || 'B2B',           // 5
      l.headline,                            // 6
      l.businessWebsite || 'Unavailable',    // 7
      l.location,                            // 8
      l.businessCity || 'Unavailable',       // 9
      l.businessEmail || 'Unavailable',      // 10
      l.businessPhone || 'Unavailable',      // 11
      'N/A',                                 // 12
      l.profileUrl,                          // 13: Contact Source URL (URI)
      l.instagramUsername ? `@${l.instagramUsername}` : 'Unavailable', // 14
      l.instagramProfileUrl || 'Unavailable',// 15
      l.instagramVerificationStatus || 'Not Checked', // 16
      'N/A',                                 // 17
      l.relevanceScore || 0,                 // 18
      l.relevanceExplanation || 'Discovered',// 19
      l.contactVerificationStatus || 'Not checked', // 20
      l.profileUrl,                          // 21: Source URL (URI)
      l.dateAdded,                           // 22
      l.status,                              // 23
      l.notes                                // 24
    ];
    HEADERS.forEach((h, i) => { obj[h] = values[i]; });
    return obj;
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
  XLSX.writeFile(workbook, `leads_${clientName.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.xlsx`);
}
