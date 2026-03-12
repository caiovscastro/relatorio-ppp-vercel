// /api/bono-contato.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(data));
}

function getEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v) : "";
}

function normalizeKey(s) {
  return String(s || "").trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return json(res, 405, { sucesso: false, mensagem: "Método não permitido." });
    }

    const session = requireSession(req, res, {
      allowedProfiles: ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP", "BASE_BD"]
    });
    if (!session) return;

    const loja = normalizeKey(req.query?.loja);
    if (!loja) return json(res, 400, { sucesso: false, mensagem: "Parâmetro 'loja' é obrigatório." });

    const spreadsheetId = getEnv("SPREADSHEET_ID");
    const clientEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKeyEnv = getEnv("GOOGLE_PRIVATE_KEY");
    const privateKeyRaw = privateKeyEnv ? privateKeyEnv.replace(/\\n/g, "\n") : "";

    if (!spreadsheetId || !clientEmail || !privateKeyRaw) {
      return json(res, 500, { sucesso: false, mensagem: "Variáveis de ambiente não configuradas." });
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKeyRaw,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const range = "CONTATOS_BONO!A:B";
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const values = resp?.data?.values || [];
    let whatsapp = "";

    for (let i = 0; i < values.length; i++) {
      const row = values[i] || [];
      const lojaRow = normalizeKey(row[0]);
      const telRow = normalizeKey(row[1]);
      if (lojaRow && lojaRow === loja) {
        whatsapp = telRow;
        break;
      }
    }

    if (!whatsapp) {
      return json(res, 200, { sucesso: false, mensagem: "Contato não encontrado para a loja informada." });
    }

    return json(res, 200, { sucesso: true, whatsapp });
  } catch (err) {
    console.error("[bono-contato] erro:", err);
    return json(res, 500, { sucesso: false, mensagem: "Erro ao consultar contato do responsável." });
  }
}
