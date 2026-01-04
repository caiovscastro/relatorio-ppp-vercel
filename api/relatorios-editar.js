// api/relatorios-editar.js
// Edita um registro na aba RELATORIO, localizando a LINHA PELO ID (coluna P)
// e atualizando SOMENTE:
// - L (RELATORIO/OBSERVAÇÃO)
// - M (QUANTIDADE)
// - N (VALOR UNITARIO)

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js"; // ✅ NOVO

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas corretamente (EDIT).");
}

/**
 * Cria cliente autenticado do Google Sheets (LEITURA + ESCRITA).
 */
async function getSheetsClientWrite() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Sanitiza valores que serão gravados.
 */
function limparTexto(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export default async function handler(req, res) {
  // Somente POST para edição
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  // ✅ NOVO: exige sessão válida (8h via cookie)
  const session = requireSession(req, res);
  if (!session) return;

  try {
    const body = req.body || {};

    const registroOriginal = body.registroOriginal || null;
    const edicoes = body.edicoes || null;

    if (!registroOriginal || !edicoes) {
      return res.status(400).json({ sucesso: false, message: "Payload inválido." });
    }

    const idRegistro =
      registroOriginal.idRegistro ||
      registroOriginal.ID_REGISTRO ||
      registroOriginal.id ||
      "";

    if (!idRegistro) {
      return res.status(400).json({
        sucesso: false,
        message: "ID do registro não encontrado (campo id/idRegistro).",
      });
    }

    const novoRelatorio = limparTexto(edicoes.relatorio).trim();
    const novaQtd = limparTexto(edicoes.quantidade).trim();
    const novoValorUnit = limparTexto(edicoes.valorUnitario).trim();

    const sheets = await getSheetsClientWrite();

    const rangeIds = "RELATORIO!P2:P";
    const respIds = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeIds,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rowsIds = respIds.data.values || [];
    let linhaPlanilha = null;

    for (let i = 0; i < rowsIds.length; i++) {
      const idNaLinha = (rowsIds[i]?.[0] ?? "").toString().trim();
      if (idNaLinha === String(idRegistro).trim()) {
        linhaPlanilha = 2 + i;
        break;
      }
    }

    if (!linhaPlanilha) {
      return res.status(404).json({
        sucesso: false,
        message: `ID não encontrado na coluna P: ${idRegistro}`,
      });
    }

    const rangeUpdate = `RELATORIO!L${linhaPlanilha}:N${linhaPlanilha}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rangeUpdate,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[novoRelatorio, novaQtd, novoValorUnit]],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Registro editado com sucesso.",
      id: idRegistro,
      linha: linhaPlanilha,
    });
  } catch (erro) {
    console.error("Erro em /api/relatorios-editar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao editar registro.",
      detalhe: erro.message || String(erro),
    });
  }
}
