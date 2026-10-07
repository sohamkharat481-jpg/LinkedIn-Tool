import { LeadRecord, GoogleSheetExportResult } from '../types';
import { normalizeLinkedInUrl } from './deduplication';

const HEADERS = [
  'Full Name',
  'Headline',
  'Current Job Title',
  'Company Name',
  'Location',
  'LinkedIn Profile',
  'Connections/Followers',
  'Last Activity Date',
  'Date Added',
  'Status',
  'Notes'
];

export async function exportLeadsToGoogleSheet(
  accessToken: string,
  clientName: string,
  leads: LeadRecord[],
  existingSpreadsheetId?: string
): Promise<GoogleSheetExportResult> {
  if (!accessToken) {
    throw new Error('Google OAuth Access Token is missing. Please sign in with Google first.');
  }

  if (!leads || leads.length === 0) {
    return {
      success: true,
      spreadsheetId: existingSpreadsheetId || '',
      spreadsheetUrl: existingSpreadsheetId ? `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}` : '',
      addedCount: 0,
      skippedDuplicatesCount: 0,
      message: 'Export completed — 0 leads selected for export.'
    };
  }

  try {
    let spreadsheetId = existingSpreadsheetId;
    let isNewSheet = false;

    // Step 1: If spreadsheetId is not provided, search for existing sheet in Drive or create one
    if (!spreadsheetId) {
      const searchTitle = `LinkedIn Leads - ${clientName}`;
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(searchTitle)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          spreadsheetId = searchData.files[0].id;
        }
      }

      // If still no spreadsheet found, create a new one
      if (!spreadsheetId) {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: {
              title: `LinkedIn Leads - ${clientName}`
            },
            sheets: [
              {
                properties: { title: 'Leads' },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: HEADERS.map((h) => ({
                          userEnteredValue: { stringValue: h },
                          userEnteredFormat: {
                            textFormat: { bold: true },
                            backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 }
                          }
                        }))
                      }
                    ]
                  }
                ]
              }
            ]
          })
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          throw new Error(`Failed to create Google Sheet: ${errText}`);
        }

        const createData = await createRes.json();
        spreadsheetId = createData.spreadsheetId;
        isNewSheet = true;
      }
    }

    if (!spreadsheetId) {
      throw new Error('Unable to obtain a valid Google Spreadsheet ID.');
    }

    // Step 2: Fetch existing rows to check for duplicate LinkedIn profiles
    let existingProfileUrls = new Set<string>();

    if (!isNewSheet) {
      const readRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A:K`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      if (readRes.ok) {
        const readData = await readRes.json();
        const rows: string[][] = readData.values || [];
        // Skip header row if present
        for (let i = 1; i < rows.length; i++) {
          const profileUrlCell = rows[i][5]; // Column F: LinkedIn Profile
          if (profileUrlCell) {
            existingProfileUrls.add(normalizeLinkedInUrl(profileUrlCell));
          }
        }
      }
    }

    // Step 3: Filter out leads whose LinkedIn profile already exists in that sheet
    const leadsToAdd: LeadRecord[] = [];
    let skippedDuplicatesCount = 0;

    for (const lead of leads) {
      const normUrl = normalizeLinkedInUrl(lead.profileUrl);
      if (existingProfileUrls.has(normUrl)) {
        skippedDuplicatesCount++;
      } else {
        leadsToAdd.push(lead);
        existingProfileUrls.add(normUrl); // Avoid duplicate entries within the batch
      }
    }

    // Step 4: Append new leads to Google Sheet
    if (leadsToAdd.length > 0) {
      const valueRows = leadsToAdd.map((lead) => [
        lead.fullName,
        lead.headline,
        lead.currentJobTitle,
        lead.companyName,
        lead.location,
        lead.profileUrl,
        lead.connectionsOrFollowers,
        lead.lastActivityDate,
        lead.dateAdded,
        lead.status,
        lead.notes
      ]);

      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A1:valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            range: 'Leads!A1',
            majorDimension: 'ROWS',
            values: valueRows
          })
        }
      );

      if (!appendRes.ok) {
        const errJson = await appendRes.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `Failed to write lead rows to Google Sheet.`);
      }
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    return {
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      addedCount: leadsToAdd.length,
      skippedDuplicatesCount,
      message: `Export completed — ${leadsToAdd.length} leads added.${
        skippedDuplicatesCount > 0 ? ` (${skippedDuplicatesCount} duplicates skipped)` : ''
      }`
    };
  } catch (error: any) {
    console.error('Google Sheets export error:', error);
    throw new Error(error.message || 'Google Sheets export failed. Please check your permissions.');
  }
}
