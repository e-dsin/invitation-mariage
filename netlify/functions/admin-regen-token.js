const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let adminToken, phone;
  try { ({ token: adminToken, phone } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  try {
    const payload = jwt.verify(adminToken, process.env.OTP_SECRET);
    if (payload.role !== "admin") throw new Error("Not admin");
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session admin expirée" }) };
  }

  if (!phone) return { statusCode: 400, body: JSON.stringify({ error: "Numéro manquant" }) };

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: "Invités!A:L",
    });
    const rows = res.data.values || [];
    let rowIndex = -1, prenom = "";
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][1]||"").replace(/\s/g,"") === phone.replace(/\s/g,"")) {
        rowIndex = i + 1; prenom = rows[i][0]||""; break;
      }
    }
    if (rowIndex === -1) return { statusCode: 404, body: JSON.stringify({ error: "Invité introuvable" }) };

    const newToken = crypto.randomBytes(24).toString("hex");
    const siteUrl = process.env.SITE_URL || "https://on-se-marie.ebelle.fr";
    const inviteUrl = `${siteUrl}?t=${newToken}`;

    /* Réinitialiser : token + toutes les données device + IP */
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `Invités!L${rowIndex}`,     values: [[newToken]] },  /* guest_token */
          { range: `Invités!O${rowIndex}:V${rowIndex}`, values: [["","","","","","","",""]] }, /* reset O→V (8 cols) */
        ]
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, inviteUrl, prenom }),
    };
  } catch (err) {
    console.error("admin-regen-token error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur" }) };
  }
};