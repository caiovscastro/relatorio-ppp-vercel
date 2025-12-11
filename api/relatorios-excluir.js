// api/relatorios-excluir.js
//
// Exclui um registro da aba RELATORIO com base em TODOS os campos da linha.
// A ideia é:
// 1) receber um objeto "registro" no body (mesmo formato da /api/relatorios),
// 2) ler todas as linhas da aba RELATORIO!A2:O,
// 3) encontrar a linha que bate EXACTAMENTE com o registro,
// 4) excluir essa linha via deleteDimension.
//
// IMPORTANTE:
// - Usa as mesmas variáveis de ambiente:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   SPREADSHEET_ID
//
// - Escopo precisa ser de escrita: 'https://www.googleapis.com/auth/spreadsheets'

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas corretamente.");
}

/**
 * Cria cliente autenticado do Google Sheets com permissão de escrita.
 */
async function getSheetsClientWrite() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

/**
 * Monta um array com os valores da linha na mesma ordem da planilha RELATORIO.
 * A ordem esperada em RELATORIO!A:O é:
 * A  DATA/HORA
 * B  LOJAS
 * C  USÚARIOS
 * D  EAN
 * E  COD CONSINCO
 * F  PRODUTO
 * G  DEPARTAMENTO
 * H  SECAO
 * I  GRUPO
 * J  SUBGRUPO
 * K  CATEGORIA
 * L  RELATORIO/OBSERVAÇÃO
 * M  QUANTIDADE
 * N  VALOR UNITARIO
 * O  DOCUMENTO
 */
function montarLinhaDoRegistro(reg) {
  return [
    reg.dataHora || "",
    reg.loja || "",
    reg.usuario || "",
    reg.ean || "",
    reg.codConsinco || "",
    reg.produto || "",
    reg.departamento || "",
    reg.secao || "",
    reg.grupo || "",
    reg.subgrupo || "",
    reg.categoria || "",
    reg.relatorio || "",
    reg.quantidade || "",
    reg.valorUnitario || "",
    reg.documento || "",
  ];
}

/**
 * Compara duas linhas (arrays) posição a posição.
 */
function linhasIguais(l1, l2) {
  if (!Array.isArray(l1) || !Array.isArray(l2)) return false;
  if (l1.length !== l2.length) return false;
  for (let i = 0; i < l1.length; i++) {
    if ((l1[i] || "") !== (l2[i] || "")) return false;
  }
  return true;
}

export default async function handler(req, res) {
  // Usaremos POST para a exclusão, conforme esperado pelo front.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração de Google Sheets incompleta. Verifique variáveis de ambiente.",
    });
  }

  try {
    const { registro } = req.body || {};

    if (!registro || typeof registro !== "object") {
      return res.status(400).json({
        sucesso: false,
        message: "Parâmetro 'registro' é obrigatório e deve ser um objeto.",
      });
    }

    const sheets = await getSheetsClientWrite();

    // 1) Descobre o sheetId da aba RELATORIO
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const abaRelatorio = (spreadsheet.data.sheets || []).find(
      (s) => s.properties?.title === "RELATORIO"
    );

    if (!abaRelatorio || !abaRelatorio.properties?.sheetId) {
      return res.status(500).json({
        sucesso: false,
        message: "Aba 'RELATORIO' não encontrada na planilha.",
      });
    }

    const sheetId = abaRelatorio.properties.sheetId;

    // 2) Lê todas as linhas atuais da aba RELATORIO (da linha 2 para baixo)
    const range = "RELATORIO!A2:O";
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = resposta.data.values || [];

    // 3) Monta a linha alvo a partir do registro enviado
    const linhaAlvo = montarLinhaDoRegistro(registro);

    // 4) Encontra o índice da linha que bate EXACTAMENTE com a linha alvo
    let indexEncontrado = -1;
    for (let i = 0; i < rows.length; i++) {
      const linhaAtual = rows[i];
      if (linhasIguais(linhaAtual, linhaAlvo)) {
        indexEncontrado = i;
        break;
      }
    }

    if (indexEncontrado === -1) {
      // Não encontrou linha igual — pode ter sido alterada manualmente na planilha
      return res.status(404).json({
        sucesso: false,
        message: "Registro não encontrado na planilha para exclusão.",
      });
    }

    /**
     * 5) Calcula o índice da linha na planilha para o deleteDimension:
     *
     *    - rows[0] corresponde à linha 2 da planilha.
     *    - Em deleteDimension, o índice é 0-based considerando TODAS as linhas.
     *      Linha 1 da planilha -> índice 0
     *      Linha 2 da planilha -> índice 1
     *
     *    Portanto:
     *      sheetRowIndex = 1 (linha 2) + indexEncontrado
     */
    const sheetRowIndex = 1 + indexEncontrado;

    // 6) Monta a requisição de exclusão de uma única linha
    const batchRequest = {
      spreadsheetId,
      resource: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1,
              },
            },
          },
        ],
      },
    };

    await sheets.spreadsheets.batchUpdate(batchRequest);

    return res.status(200).json({
      sucesso: true,
      message: "Registro excluído com sucesso da planilha.",
    });
  } catch (erro) {
    console.error("Erro em /api/relatorios-excluir:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao excluir registro.",
      detalhe: erro.message || String(erro),
    });
  }
}
