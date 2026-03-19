const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const FOLDER_MAP = {
  once: "Il etait une fois",
  cer:  "Céremonie",
  ck1:  "Cocktail 1",
  ck2:  "Cocktail 2",
};

async function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    /* scope complet nécessaire pour lire description + thumbnailLink */
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function getFolderId(drive, folderName) {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID;
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files.length > 0 ? res.data.files[0].id : null;
}

async function listPhotos(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
    fields: "files(id,name,description,createdTime,thumbnailLink,mimeType)",
    orderBy: "createdTime desc",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files.map((f) => {
    /* Extraire le prénom uploader depuis le nom du fichier (format: timestamp_Prénom_fichier.jpg)
       ou depuis description si disponible */
    let uploader = f.description || "";
    if (!uploader && f.name) {
      const parts = f.name.split("_");
      if (parts.length >= 2) uploader = parts[1];
    }
    return {
      id: f.id,
      name: f.name,
      uploader: uploader,
      createdTime: f.createdTime,
      /* thumbnailLink fourni par Drive API si disponible, sinon URL construite */
      thumbnailUrl: f.thumbnailLink
        ? f.thumbnailLink.replace("=s220", "=s400")
        : `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`,
      fullUrl: `https://lh3.googleusercontent.com/d/${f.id}`,
    };
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token, category;
  try { ({ token, category } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  let payload;
  try {
    payload = jwt.verify(token, process.env.OTP_SECRET);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session expirée" }) };
  }

  const niveau = payload.niveau || 0;
  const isAdmin = payload.role === "admin";
  if (!isAdmin) {
    if (category === "ck1" && niveau < 2) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
    if (category === "ck2" && niveau < 3) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  const folderName = FOLDER_MAP[category];
  if (!folderName) return { statusCode: 400, body: JSON.stringify({ error: "Catégorie invalide" }) };

  try {
    const drive = await getDriveClient();
    const folderId = await getFolderId(drive, folderName);
    if (!folderId) {
      return { statusCode: 200, body: JSON.stringify({ photos: [], warning: "Dossier introuvable — vérifiez DRIVE_ROOT_FOLDER_ID" }) };
    }
    const photos = await listPhotos(drive, folderId);
    return { statusCode: 200, body: JSON.stringify({ photos }) };
  } catch (err) {
    console.error("drive-list error:", err.message, err.code);
    return { statusCode: 500, body: JSON.stringify({ error: err.message, code: err.code || null }) };
  }
};
