// api/relatorios-editar.js
// Edita um registro na aba RELATORIO, localizando a LINHA PELO ID (coluna P)
// e atualizando SOMENTE:
// - L (RELATORIO/OBSERVAÇÃO)
// - M (QUANTIDADE)
// - N (VALOR UNITARIO)
//
// ENV (mesmas do seu /api/relatorios):
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY
// SPREADSHEET_ID
//
// Observação importante:
// - A service account precisa ter permissão de "Editor" na planilha
// - O escopo aqui é de ESCRITA (spreadsheets), não readonly.

import { google } from "googleapis";

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
    // ESCOPO DE ESCRITA:
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Sanitiza valores que serão gravados.
 * - Mantém padrão "texto" para não mudar sua forma de armazenamento.
 * - Se você quiser gravar como número no Sheets, aí sim converteríamos para Number.
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

  try {
    const body = req.body || {};

    // O front deve enviar:
    // {
    //   registroOriginal: { ... registro com id ... },
    //   edicoes: { relatorio, quantidade, valorUnitario }
    // }
    const registroOriginal = body.registroOriginal || null;
    const edicoes = body.edicoes || null;

    if (!registroOriginal || !edicoes) {
      return res.status(400).json({ sucesso: false, message: "Payload inválido." });
    }

    // Seu /api/relatorios expõe o ID como "id"
    // então aceitamos: idRegistro | ID_REGISTRO | id
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

    // Campos editáveis (somente estes)
    const novoRelatorio = limparTexto(edicoes.relatorio).trim();
    const novaQtd = limparTexto(edicoes.quantidade).trim();
    const novoValorUnit = limparTexto(edicoes.valorUnitario).trim();

    const sheets = await getSheetsClientWrite();

    // 1) Ler coluna P (ID) para descobrir a linha exata
    // P2:P (a partir da linha 2, pois linha 1 geralmente é cabeçalho)
    const rangeIds = "RELATORIO!P2:P";
    const respIds = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeIds,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rowsIds = respIds.data.values || []; // [[id1],[id2],...]
    let linhaPlanilha = null;

    for (let i = 0; i < rowsIds.length; i++) {
      const idNaLinha = (rowsIds[i]?.[0] ?? "").toString().trim();
      if (idNaLinha === String(idRegistro).trim()) {
        // Linha real = 2 + i (porque P2 corresponde ao índice 0)
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

    // 2) Atualizar L/M/N na linha encontrada
    // L = Relatorio, M = Quantidade, N = Valor Unitario
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
