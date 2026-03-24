const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token;
  try { ({ token } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  let payload;
  try { payload = jwt.verify(token, process.env.OTP_SECRET); }
  catch { return { statusCode: 401, body: JSON.stringify({ error: "Session expirée" }) }; }

  const cleanPhone = (payload.phone || "").replace(/\s/g, "");

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Invités!A:K",
    });

    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const tel = (row[1] || "").replace(/\s/g, "");
      if (tel === cleanPhone) {
        const presence = (row[5] || "").trim().toLowerCase();
        const isOui = presence === "oui";
        const isNon = presence === "non";
        const submitted = isOui || isNon;
        return {
          statusCode: 200,
          body: JSON.stringify({
            rsvp_submitted:  submitted,
            rsvp_presence:   submitted ? (isOui ? "oui" : "non") : "",
            rsvp_regime:     row[6] || "",
            rsvp_message:    row[7] || "",
            rsvp_date:       row[8] || "",
            rsvp_ck1:        (row[9] || "").trim().toLowerCase(),
            rsvp_ck2:        (row[10] || "").trim().toLowerCase(),
          }),
        };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ rsvp_submitted: false, rsvp_presence: "" }) };
  } catch (err) {
    console.error("check-rsvp error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
