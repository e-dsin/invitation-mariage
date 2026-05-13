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

async function findGuestByToken(sheets, token) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:W",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[11] || "") === token) {
      return {
        rowIndex:    i + 1,
        prenom:      row[0]  || "",
        phone:       row[1]  || "",
        niveau:      parseInt(row[2]) || 1,
        firstClick:  row[14] || "",
        storedIp:    row[15] || "",
        deviceUuid:  row[20] || "",   /* Col U = index 20 */
        deviceFp:    row[21] || "",   /* Col V = index 21 */
        shortCode:   row[22] || "",   /* Col W = index 22 */
        shortCode:   row[22] || "",   /* Col W = index 22 */
        table:       row[18] || "",   /* Col S = index 18 */
      };
    }
  }
  return null;
}

function getClientIp(event) {
  return (event.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || event.headers["x-real-ip"]
    || "unknown";
}

async function geolocate(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=lat,lon,status`);
    const data = await res.json();
    if (data.status === "success") return { lat: data.lat, lon: data.lon };
  } catch (e) { console.warn("geolocate error:", e.message); }
  return null;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}


/* Générer un short_code 8 chars sans caractères ambigus */
function generateShortCode() {
  const crypto = require("crypto");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/* Similarité fingerprint — compte les champs identiques */
function fpSimilarity(fp1str, fp2str) {
  try {
    const a = JSON.parse(fp1str);
    const b = JSON.parse(fp2str);
    const keys = ['tz','lang','screen','platform'];
    let match = 0;
    keys.forEach(k => { if(a[k] && b[k] && a[k]===b[k]) match++; });
    return match / keys.length; /* 0.0 → 1.0 */
  } catch { return 0; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let guestToken, deviceUuid, deviceFp;
  try { ({ guestToken, deviceUuid, deviceFp } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  if (!guestToken) return { statusCode: 400, body: JSON.stringify({ error: "Token manquant" }) };

  try {
    const sheets = await getSheetsClient();
    const guest = await findGuestByToken(sheets, guestToken);

    if (!guest) {
      return { statusCode: 404, body: JSON.stringify({
        error: "Lien d'invitation invalide. Veuillez contacter les mariés."
      })};
    }

    const clientIp = getClientIp(event);
    const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

    /* ── GÉNÉRER SHORT_CODE si absent (migration invités existants) ── */
    if (!guest.shortCode) {
      guest.shortCode = generateShortCode();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Invités!W${guest.rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [[guest.shortCode]] },
      });
      console.log(`short_code généré pour ${guest.prenom}: ${guest.shortCode}`);
    }

        /* ── VÉRIFICATION DEVICE (Option C) ── */
    if (!guest.deviceUuid && !guest.deviceFp) {
      /* ── PREMIER ACCÈS : enregistrer UUID + fingerprint + IP ── */
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `Invités!O${guest.rowIndex}`, values: [[now]] },           /* timestamp_first_click */
            { range: `Invités!P${guest.rowIndex}`, values: [[clientIp]] },      /* adr_ip */
            { range: `Invités!T${guest.rowIndex}`, values: [["green"]] },       /* ip_status */
            { range: `Invités!U${guest.rowIndex}`, values: [[deviceUuid||""]] },/* device_uuid */
            { range: `Invités!V${guest.rowIndex}`, values: [[deviceFp||""]] },  /* device_fp */
          ]
        }
      });

    } else {
      /* ── ACCÈS SUIVANTS : vérifier l'appareil ── */
      const uuidMatch  = deviceUuid && guest.deviceUuid && deviceUuid === guest.deviceUuid;
      const fpScore    = (deviceFp && guest.deviceFp) ? fpSimilarity(guest.deviceFp, deviceFp) : 0;
      const fpMatch    = fpScore >= 0.75; /* au moins 3/4 champs identiques */

      console.log(`Device check — ${guest.prenom}: uuid=${uuidMatch}, fp=${fpScore.toFixed(2)}`);

      if (!uuidMatch && !fpMatch) {
        /* ── REFUS : appareil différent sur les deux critères ── */
        /* Logger la tentative */
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Invités!Q${guest.rowIndex}`,
          valueInputOption: "RAW",
          requestBody: { values: [[now + " — tentative appareil différent — IP: " + clientIp]] }
        });
        return { statusCode: 403, body: JSON.stringify({
          error: "Ce lien d'invitation a déjà été ouvert sur un autre appareil. Veuillez contacter les mariés."
        })};
      }

      /* ── ACCÈS AUTORISÉ : logger IP pour le rapport ── */
      let ipStatus = "green";
      if (clientIp !== guest.storedIp && guest.storedIp) {
        const [geo1, geo2] = await Promise.all([geolocate(guest.storedIp), geolocate(clientIp)]);
        if (geo1 && geo2) {
          const dist = haversine(geo1.lat, geo1.lon, geo2.lat, geo2.lon);
          ipStatus = dist > 100 ? "red" : "orange";
        } else {
          ipStatus = "orange";
        }
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `Invités!Q${guest.rowIndex}`, values: [[now + " — " + clientIp]] },
            { range: `Invités!T${guest.rowIndex}`, values: [[ipStatus]] },
            /* Mettre à jour fingerprint si UUID correspond mais FP a légèrement changé (mise à jour navigateur) */
            ...(uuidMatch && !fpMatch && deviceFp
              ? [{ range: `Invités!V${guest.rowIndex}`, values: [[deviceFp]] }]
              : [])
          ]
        }
      });
    }

    /* ── JWT 24h ── */
    const token = jwt.sign(
      { prenom: guest.prenom, phone: guest.phone, niveau: guest.niveau, guestToken },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, prenom: guest.prenom, niveau: guest.niveau, token, shortCode: guest.shortCode, table: guest.table }),
    };

  } catch (err) {
    console.error("resolve-token error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur." }) };
  }
};