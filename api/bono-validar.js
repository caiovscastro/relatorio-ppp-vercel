// /api/bono-validar.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

function bad(res, status, message, extra = {}) {
  return res.status(status).json({ sucesso: false, message, ...extra });
}

function ok(res, obj) {
  return res.status(200).json(obj);
}

function normStr(v) {
  return String(v ?? "").trim();
}
function normKey(v) {
  return normStr(v).toUpperCase().replace(/\s+/g, " ");
}

function statusParaPlanilha(statusRecebido) {
  // Na planilha você disse que é "Validado"
  const s = normKey(statusRecebido);
  if (s.includes("VALID")) return "Validado";
  if (s.includes("PEND")) return "PENDENTE";
  // fallback: como é rota de validação, assume Validado
  return "Validado";
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido. Use POST.");
  }

  // ✅ protege com sessão (igual ao restante do sistema)
  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return bad(res, 500, "Configuração do servidor incompleta (ENV).", {
      faltando: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: !serviceAccountEmail,
        GOOGLE_PRIVATE_KEY: !privateKey,
        SPREADSHEET_ID: !spreadsheetId,
      },
    });
  }

  try {
    // body pode vir como objeto ou string dependendo do runtime
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const documento = normStr(body.documento);
    const status = statusParaPlanilha(body.status);

    if (!documento) {
      return bad(res, 400, "Campo 'documento' é obrigatório.");
    }

    const sheets = await getSheetsClient();

    // 1) Ler BONO!A:L para achar as linhas do documento
    const leitura = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "BONO!A:L",
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = leitura.data.values || [];
    if (values.length <= 1) {
      return ok(res, { sucesso: true, atualizadas: 0, status_gravado: status });
    }

    // Documento está na coluna L (índice 11) e Status na coluna K (K = índice 10)
    // i=1 -> linha 2 (pulando cabeçalho)
    const updates = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const docCell = normStr(row[11]); // L

      if (docCell && normKey(docCell) === normKey(documento)) {
        const sheetRow = i + 1; // linha real na planilha
        updates.push({
          range: `BONO!K${sheetRow}`,
          values: [[status]],
        });
      }
    }

    if (!updates.length) {
      return bad(res, 404, "Documento não encontrado para validação.");
    }

    // 2) Atualizar em lote
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });

    return ok(res, {
      sucesso: true,
      atualizadas: updates.length,
      status_gravado: status,
    });
  } catch (e) {
    console.error("[BONO-VALIDAR] Erro:", e);
    return bad(res, 500, "Falha ao validar no servidor.", {
      detalhe: e?.message ? String(e.message) : String(e),
    });
  }
}
