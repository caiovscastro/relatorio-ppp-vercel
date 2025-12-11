// api/relatorios-excluir.js
//
// Exclui um registro da aba RELATORIO de forma segura.
//
// NOVO: Prioriza exclusão por ID único salvo na coluna P (ID_REGISTRO).
// Fallback: se não houver ID no registro recebido, faz a comparação completa A:O
// exatamente como antes, para manter compatibilidade com registros antigos.
//
// Pré-requisitos (variáveis de ambiente na Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID

import { google } from "googleapis";

// Lê credenciais das variáveis de ambiente
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

// Loga no servidor caso falte algo (não quebra a build, mas avisa)
if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas corretamente.");
}

/**
 * Cria cliente autenticado do Google Sheets com permissão de LEITURA + ESCRITA.
 */
async function getSheetsClientWrite() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"], // leitura + escrita
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

/**
 * Monta um array com os valores da linha na mesma ordem da planilha RELATORIO,
 * considerando SOMENTE as colunas A:O (sem ID).
 *
 * Estrutura esperada em RELATORIO:
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
 * P  ID_REGISTRO (NOVO – usado apenas para exclusão segura)
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
 * Usado apenas para A:O (15 colunas, sem o ID).
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
  // Exclusão via POST (mantém simetria com o front)
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Confere se as variáveis de ambiente estão ok
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

    // Tenta extrair o ID do registro recebido do front.
    // Nome principal: idRegistro, mas aceitamos variações para robustez.
    const idRegistro =
      registro.idRegistro ||
      registro.ID_REGISTRO ||
      registro.id ||
      "";

    const sheets = await getSheetsClientWrite();

    // 1) Descobre o sheetId da aba RELATORIO na planilha
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const abaRelatorio = (spreadsheet.data.sheets || []).find(
      (s) => s.properties?.title === "RELATORIO"
    );

    if (!abaRelatorio || !abaRelatorio.properties?.sheetId) {
      return res.status(500).json({
        sucesso: false,
        message: "Aba 'RELATORIO' não encontrada.",
      });
    }

    const sheetId = abaRelatorio.properties.sheetId;

    // 2) Lê todas as linhas atuais da aba RELATORIO (da linha 2 para baixo),
    //    incluindo a coluna P (ID_REGISTRO).
    //
    //    rows[0] => linha 2 na planilha
    //    rows[i] => linha (i + 2) na planilha
    const range = "RELATORIO!A2:P";
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = resposta.data.values || [];

    // 3) Se tivermos ID_REGISTRO vindo do front, priorizamos exclusão por ID (coluna P).
    let indexEncontrado = -1;

    if (idRegistro) {
      for (let i = 0; i < rows.length; i++) {
        const linhaAtual = rows[i] || [];
        // Coluna P = índice 15 (0-based: A=0, B=1, ..., O=14, P=15)
        const idNaLinha = linhaAtual[15] || "";
        if (idNaLinha === idRegistro) {
          indexEncontrado = i;
          break;
        }
      }

      if (indexEncontrado === -1) {
        return res.status(404).json({
          sucesso: false,
          message: "Registro (ID_REGISTRO) não encontrado na planilha para exclusão.",
        });
      }
    } else {
      // 4) Fallback (legado): não há ID no registro => comparamos A:O exatamente.
      const linhaAlvo = montarLinhaDoRegistro(registro); // 15 colunas esperadas

      for (let i = 0; i < rows.length; i++) {
        const linhaAtualCompleta = rows[i] || [];
        const linhaAtualAO = linhaAtualCompleta.slice(0, 15); // A:O (índices 0 a 14)
        if (linhasIguais(linhaAtualAO, linhaAlvo)) {
          indexEncontrado = i;
          break;
        }
      }

      if (indexEncontrado === -1) {
        return res.status(404).json({
          sucesso: false,
          message: "Registro não encontrado na planilha para exclusão (sem ID).",
        });
      }
    }

    /**
     * 5) Calcula o índice da linha na planilha para o deleteDimension:
     *
     *    - rows[0] corresponde à linha 2 da planilha.
     *    - Em deleteDimension, o índice é 0-based em TODAS as linhas:
     *        Linha 1 da planilha -> índice 0
     *        Linha 2 da planilha -> índice 1
     *        Linha N da planilha -> índice (N - 1)
     *
     *    Portanto:
     *      sheetRowIndex = 1 (linha 2) + indexEncontrado
     */
    const sheetRowIndex = 1 + indexEncontrado;

    // 6) Monta a requisição de exclusão de uma única linha.
    //    Aqui usamos o formato recomendado da lib (requestBody).
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1, // exclui somente essa linha
              },
            },
          },
        ],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Registro excluído com sucesso.",
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
