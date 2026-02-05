// /api/_contatosBonoSheet.js
import { google } from "googleapis";

// ✅ use o mesmo padrão das suas envs atuais
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

export const SHEET_NAME = "CONTATOS_BONO"; // A:B (A=Loja, B=Celular)

export function bad(res, status, message) {
  return res.status(status).json({ sucesso: false, message });
}

export function ok(res, obj) {
  return res.status(200).json(obj);
}

export async function getSheetsClientRW() {
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    throw new Error("ENV Google incompleta (GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY/SPREADSHEET_ID).");
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export function getSpreadsheetId() {
  return spreadsheetId;
}
