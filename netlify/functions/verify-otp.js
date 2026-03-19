const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const JWT_SECRET = process.env.OTP_SECRET;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function findGuestByPhone(sheets, phone) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:J",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tel = (row[1] || "").replace(/\s/g, "");
    if (tel === phone) {
      return {
        rowIndex: i + 1,
        prenom: row[0],
        niveau: parseInt(row[2]) || 1,
        phone: row[1],
        otpCode: row[3] || "",
        otpExpires: parseInt(row[4]) || 0,
      };
    }
  }
  return null;
}

async function findGuestByToken(sheets, token) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:J",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[9] || "") === token) {
      return {
        rowIndex: i + 1,
        prenom: row[0],
        niveau: parseInt(row[2]) || 1,
        phone: row[1],
        otpCode: row[3] || "",
        otpExpires: parseInt(row[4]) || 0,
      };
    }
  }
  return null;
}

async function clearOTP(sheets, rowIndex) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Invités!D${rowIndex}:E${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [["", ""]] },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let phone, otp, guestToken;
  try {
    ({ phone, otp, guestToken } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) };
  }

  if (!otp) {
    return { statusCode: 400, body: JSON.stringify({ error: "Code OTP manquant" }) };
  }

  try {
    const sheets = await getSheetsClient();
    let guest = null;

    if (guestToken) {
      guest = await findGuestByToken(sheets, guestToken);
      if (!guest) {
        return { statusCode: 404, body: JSON.stringify({ error: "Lien d'invitation invalide." }) };
      }
    } else if (phone) {
      const cleanPhone = phone.replace(/\s/g, "");
      guest = await findGuestByPhone(sheets, cleanPhone);
      if (!guest) {
        return { statusCode: 404, body: JSON.stringify({ error: "Invité introuvable" }) };
      }
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Paramètre manquant." }) };
    }

    if (!guest.otpCode) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Aucun code actif. Veuillez rafraîchir la page." }),
      };
    }

    if (Date.now() > guest.otpExpires) {
      await clearOTP(sheets, guest.rowIndex);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Code expiré. Veuillez rafraîchir la page pour en recevoir un nouveau." }),
      };
    }

    if (otp.trim() !== guest.otpCode.trim()) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Code incorrect. Vérifiez votre message WhatsApp." }),
      };
    }

    await clearOTP(sheets, guest.rowIndex);

    const token = jwt.sign(
      { prenom: guest.prenom, phone: guest.phone, niveau: guest.niveau },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        prenom: guest.prenom,
        niveau: guest.niveau,
        token,
      }),
    };
  } catch (err) {
    console.error("verify-otp error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erreur serveur. Réessayez dans quelques instants." }),
    };
  }
};
