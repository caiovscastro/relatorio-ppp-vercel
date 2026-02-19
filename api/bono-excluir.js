// /api/bono-excluir.js
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

function perfilEhAdmin(perfil) {
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

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return bad(res, 500, "Configuração do servidor incompleta (ENV).");
  }

  if (!perfilEhAdmin(session.perfil)) {
    return bad(res, 403, "Perfil sem permissão para exclusão.");
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const documento = normStr(body.documento);
    const confirmUser = normStr(body.confirmUser);

    if (!documento) return bad(res, 400, "Campo 'documento' é obrigatório.");
    if (!confirmUser) return bad(res, 400, "Campo 'confirmUser' é obrigatório.");

    const logged = normStr(session.usuario);
    if (!logged) return bad(res, 401, "Sessão inválida (usuário ausente).");

    if (normKey(confirmUser) !== normKey(logged)) {
      return bad(res, 400, "Usuário digitado não confere com o usuário logado.");
    }

    const sheets = await getSheetsClient();

    const leitura = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "BONO!A:Q",
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = leitura.data.values || [];
    if (values.length <= 1) return ok(res, { sucesso: true, limpadas: 0 });

    const linhasParaLimpar = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const docCell = normStr(row[11]); // L
      if (docCell && normKey(docCell) === normKey(documento)) {
        linhasParaLimpar.push(i + 1); // 1-based
      }
    }

    // ✅ não retornar 404 (tratamos como já limpo / não encontrado)
    if (!linhasParaLimpar.length) {
      return ok(res, { sucesso: true, limpadas: 0, message: "Documento não encontrado (possivelmente já limpo)." });
    }

    const emptyRow = Array.from({ length: 17 }, () => ""); // A..Q
    const data = linhasParaLimpar.map((rowNumber) => ({
      range: `BONO!A${rowNumber}:Q${rowNumber}`,
      values: [emptyRow],
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });

    return ok(res, { sucesso: true, limpadas: linhasParaLimpar.length });
  } catch (e) {
    console.error("[BONO-EXCLUIR] Erro:", e);
    return bad(res, 500, "Falha ao excluir no servidor.", {
      detalhe: e?.message ? String(e.message) : String(e),
    });
  }
}
