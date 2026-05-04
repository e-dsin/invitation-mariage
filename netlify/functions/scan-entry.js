const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const MAX_PLACES = 9;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getAllGuests(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:S",
  });
  return res.data.values || [];
}

async function recordEntry(sheets, rowIndex, event) {
  const now = new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  /* Colonnes : ck1 → col M (index 12), ck2 → col N (index 13) */
  const col = event === "ck1" ? "M" : "N";
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Invités!${col}${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[now]] },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let guestToken, evt;
  try { ({ guestToken, event: evt } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  try {
    const sheets = await getSheetsClient();
    const rows = await getAllGuests(sheets);

    /* Trouver l'invité par token (col L = index 11) */
    let guestRow = null, guestIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][11] || "") === guestToken) {
        guestRow = rows[i]; guestIndex = i + 1; break;
      }
    }
    if (!guestRow) return { statusCode: 404, body: JSON.stringify({ error: "Invité introuvable" }) };

    const prenom  = guestRow[0] || "";
    const niveau  = parseInt(guestRow[2]) || 1;
    const count   = parseInt(guestRow[17]) || 1; /* Col R = index 17 */
    const table   = guestRow[18] || "";           /* Col S = index 18 — champ table */
    const entryCk1 = guestRow[12] || "";          /* Col M = index 12 */
    const entryCk2 = guestRow[13] || "";          /* Col N = index 13 */

    /* Vérifier le niveau d'accès */
    if (evt === "ck1" && niveau !== 2 && niveau < 4) {
      return { statusCode: 403, body: JSON.stringify({ error: "Cet invité n'est pas au cocktail famille" }) };
    }
    if (evt === "ck2" && niveau !== 3 && niveau < 4) {
      return { statusCode: 403, body: JSON.stringify({ error: "Cet invité n'est pas au repas de mariage" }) };
    }

    /* Vérifier si déjà scanné */
    const alreadyIn = evt === "ck1" ? !!entryCk1 : !!entryCk2;
    if (alreadyIn) {
      return { statusCode: 200, body: JSON.stringify({
        success: true, prenom, event: evt, table,
        warning: "Déjà enregistré",
        alreadyIn: true,
      })};
    }

    /* Enregistrer l'entrée */
    await recordEntry(sheets, guestIndex, evt);

    /* Calculer les places restantes pour le repas (evt ck2 uniquement) */
    let placesRestantes = null;
    if (evt === "ck2" && table) {
      let occupied = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rTable = r[18] || "";
        const rEntryCk2 = r[13] || "";
        const rCount = parseInt(r[17]) || 1;
        if (rTable === table && rEntryCk2) {
          occupied += rCount;
        }
      }
      /* Ajouter le scan actuel */
      occupied += count;
      placesRestantes = Math.max(0, MAX_PLACES - occupied);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true, prenom, event: evt, table, placesRestantes,
        count,
      }),
    };
  } catch (err) {
    console.error("scan-entry error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur" }) };
  }
};
