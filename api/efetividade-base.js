// API/efetividade-base.js
// Lê a aba BASE_DADOS da planilha de Efetividade, filtrando pela LOJA

import { google } from "googleapis";

// ATENÇÃO: nomes iguais aos da Vercel (print que você mandou)
const serviceAccountEmail =
  process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];
const privateKeyRaw = process.env["CHAVE_PRIVADA_DO_GOOGLE"];
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

// Corrige quebras de linha da chave privada (caso tenha vindo com "\n")
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação com a Service Account
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Nome da aba da base
const ABA_BASE = "BASE_DADOS";
// Nome da coluna que identifica a loja (no cabeçalho)
const NOME_COL_LOJA = "LOJA";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Confere se todas as variáveis de ambiente necessárias existem
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique E-MAIL DA CONTA DE SERVIÇO DO GOOGLE, CHAVE_PRIVADA_DO_GOOGLE e SPREADSHEET_ID_EFETIVIDADE na Vercel.",
    });
  }

  // Loja vem na query string: /api/efetividade-base?loja=ULT%2001%20-%20PLANALTINA
  const loja = (req.query.loja || "").trim();
  if (!loja) {
    return res.status(400).json({
      sucesso: false,
      message: "Informe a loja na query string (?loja=...).",
    });
  }

  try {
    // Lê toda a aba BASE_DADOS (A até Z; ajuste se precisar de mais colunas)
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

    // Primeira linha = cabeçalho
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
