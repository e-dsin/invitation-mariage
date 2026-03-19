const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

async function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function createFolder(drive, name, parentId) {
  const existing = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: "files(id,name)",
  });
  if (existing.data.files.length > 0) {
    return existing.data.files[0].id;
  }
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return res.data.id;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let adminToken;
  try { ({ token: adminToken } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  try {
    const payload = jwt.verify(adminToken, process.env.OTP_SECRET);
    if (payload.role !== "admin") throw new Error("Not admin");
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
  }

  const rootId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!rootId) return { statusCode: 500, body: JSON.stringify({ error: "DRIVE_ROOT_FOLDER_ID non configuré" }) };

  try {
    const drive = await getDriveClient();
    const folders = ["Il etait une fois", "Céremonie", "Cocktail 1", "Cocktail 2"];
    const created = {};
    for (const name of folders) {
      created[name] = await createFolder(drive, name, rootId);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, folders: created }),
    };
  } catch (err) {
    console.error("drive-setup error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
