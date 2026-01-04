// API/produtos.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getEnvVars() {
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"] ||
    process.env.GOOGLE_SERVICE_EMAIL;

  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.CHAVE_PRIVADA_DO_GOOGLE;

  const spreadsheetId =
    process.env.SPREADSHEET_ID ||
    process.env.ID_DA_PLANILHA ||
    process.env.GOOGLE_SHEET_ID;

  if (!serviceAccountEmail || !privateKeyRaw || !spreadsheetId) {
    throw new Error(
      "Variáveis de ambiente ausentes. " +
        "Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_EMAIL, " +
        "GOOGLE_PRIVATE_KEY e " +
        "SPREADSHEET_ID / GOOGLE_SHEET_ID."
    );
  }

  return { serviceAccountEmail, privateKeyRaw, spreadsheetId };
}

function getAuthClient() {
  const { serviceAccountEmail, privateKeyRaw } = getEnvVars();
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  return new google.auth.JWT(serviceAccountEmail, null, privateKey, SCOPES);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // ✅ NOVO: exige sessão válida
  const session = requireSession(req, res);
  if (!session) return;

  try {
    const { spreadsheetId } = getEnvVars();
    const auth = getAuthClient();
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    const range = "BASE!A2:H";
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = response.data.values || [];

    return res.status(200).json({
      sucesso: true,
      produtos: values,
      // opcional: útil para debug controlado
      // session: { usuario: session.usuario, loja: session.loja, perfil: session.perfil }
    });
  } catch (erro) {
    console.error("Erro na API /api/produtos:", erro);

    return res.status(500).json({
      sucesso: false,
      message: "Erro interno na API de produtos.",
      detalhe: erro?.message || String(erro),
    });
  }
}
