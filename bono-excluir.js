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

function normStr(v) { return String(v ?? "").trim(); }
function normKey(v) { return normStr(v).toUpperCase().replace(/\s+/g, " "); }

function perfilEhAdmin(perfil){
  return normKey(perfil).includes("ADMIN");
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

  const session = requireSession(req, res);
  if (!session) return;

  // ✅ autorização: somente ADMIN
  if (!perfilEhAdmin(session.perfil || "")) {
    return bad(res, 403, "Apenas ADMINISTRADOR pode excluir documentos.");
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return bad(res, 500, "Configuração do servidor incompleta (ENV).");
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const documento = normStr(body.documento);

    if (!documento) return bad(res, 400, "Campo 'documento' é obrigatório.");

    const sheets = await getSheetsClient();

    // lê A:O para localizar linhas pelo documento (coluna L)
    const leitura = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "BONO!A:O",
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = leitura.data.values || [];
    if (values.length <= 1) return ok(res, { sucesso: true, limpas: 0 });

    const updates = [];
    const linhaVazia = new Array(15).fill(""); // A..O

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const docCell = normStr(row[11]); // L

      if (docCell && normKey(docCell) === normKey(documento)) {
        const sheetRow = i + 1;
        updates.push({
          range: `BONO!A${sheetRow}:O${sheetRow}`,
          values: [linhaVazia],
        });
      }
    }

    if (!updates.length) {
      return bad(res, 404, "Documento não encontrado para exclusão.");
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });

    return ok(res, { sucesso: true, limpas: updates.length });

  } catch (e) {
    console.error("[BONO-EXCLUIR] Erro:", e);
    return bad(res, 500, "Falha ao excluir no servidor.", {
      detalhe: e?.message ? String(e.message) : String(e),
    });
  }
}
