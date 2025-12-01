// api/efetividade-base.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

// Conserta "\n" na chave privada
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Nome da aba de origem
const ABA_BASE = "BASE_DADOS";
// Nome da coluna que representa a loja (ajuste se for diferente)
const NOME_COL_LOJA = "LOJA";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID_EFETIVIDADE.",
    });
  }

  const loja = (req.query.loja || "").trim();
  if (!loja) {
    return res.status(400).json({
      sucesso: false,
      message: "Informe a loja na query string (?loja=...).",
    });
  }

  try {
    // Lê toda a aba BASE_DADOS
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${ABA_BASE}!A:Z`,
    });

    const values = resp.data.values || [];
    if (!values.length) {
      return res.status(200).json({
        sucesso: true,
        registros: [],
        message: "Nenhum dado encontrado em BASE_DADOS.",
      });
    }

    // Primeiro linha = cabeçalho
    const cabecalho = values[0];
    const linhas = values.slice(1);

    // Descobre índice da coluna LOJA
    const idxLoja = cabecalho.findIndex(
      (col) => String(col || "").toUpperCase().trim() === NOME_COL_LOJA
    );

    if (idxLoja === -1) {
      return res.status(500).json({
        sucesso: false,
        message: `Coluna "${NOME_COL_LOJA}" não encontrada no cabeçalho da aba ${ABA_BASE}.`,
      });
    }

    // Filtra apenas registros da loja solicitada
    const filtrados = linhas.filter((linha) => {
      const valorLoja = String(linha[idxLoja] || "").trim();
      return valorLoja === loja;
    });

    return res.status(200).json({
      sucesso: true,
      registros: filtrados,
    });
  } catch (erro) {
    console.error("Erro em /api/efetividade-base:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao ler BASE_DADOS da planilha de Efetividade.",
      detalhe: erro.message,
    });
  }
}
