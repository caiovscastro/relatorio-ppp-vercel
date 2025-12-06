// /api/_authUsuarios.js
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

// CONFIGURAÇÃO DO GOOGLE SERVICE ACCOUNT
const serviceAccountEmail = process.env.GOOGLE_SERVICE_EMAIL;
const serviceAccountKey   = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const sheetId             = process.env.GOOGLE_SHEET_ID; // ID da planilha

export async function lerUsuariosDaPlanilha() {
  try {
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: serviceAccountKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();

    const aba = doc.sheetsByTitle["USUARIOS"];
    if (!aba) throw new Error("Aba 'USUARIOS' não encontrada");

    const linhas = await aba.getRows();

    return linhas.map((l) => ({
      usuario: String(l["USUARIO"] || "").trim().toLowerCase(),
      senha: String(l["SENHA"] || "").trim(),
      loja: String(l["LOJAS"] || "").trim(),
      perfil: String(l["PERFIL"] || "").trim().toUpperCase(),
    }));
  } catch (e) {
    console.error("Erro ao ler usuários:", e);
    return [];
  }
}
