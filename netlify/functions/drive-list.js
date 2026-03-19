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
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

async function getFolderId(drive, folderName) {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID;
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
    fields: "files(id)",
  });
  return res.data.files.length > 0 ? res.data.files[0].id : null;
}

async function listPhotos(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
    fields: "files(id,name,description,createdTime,thumbnailLink)",
    orderBy: "createdTime desc",
    pageSize: 100,
  });
  return res.data.files.map((f) => ({
    id: f.id,
    name: f.name,
    uploader: f.description || "",
    createdTime: f.createdTime,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`,
    fullUrl: `https://drive.google.com/uc?export=view&id=${f.id}`,
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token, category;
  try { ({ token, category } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  /* Vérifier JWT — invité ou admin */
  let payload;
  try {
    payload = jwt.verify(token, process.env.OTP_SECRET);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session expirée" }) };
  }

  /* Vérifier le niveau d'accès selon la catégorie */
  const niveau = payload.niveau || 99;
  if (category === "ck1" && niveau < 2 && payload.role !== "admin") {
    return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }
  if (category === "ck2" && niveau < 3 && payload.role !== "admin") {
    return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  const folderName = FOLDER_MAP[category];
  if (!folderName) return { statusCode: 400, body: JSON.stringify({ error: "Catégorie invalide" }) };

  try {
    const drive = await getDriveClient();
    const folderId = await getFolderId(drive, folderName);
    if (!folderId) {
      return { statusCode: 200, body: JSON.stringify({ photos: [] }) };
    }
    const photos = await listPhotos(drive, folderId);
    return { statusCode: 200, body: JSON.stringify({ photos }) };
  } catch (err) {
    console.error("drive-list error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
