// API/efetividade-base.js
// Lê a aba BASE_DADOS da planilha de Efetividade, filtrando pela LOJA

import { google } from "googleapis";

// NOMES EXATOS das variáveis de ambiente (iguais aos da Vercel)
const serviceAccountEmail =
  process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];
const privateKeyRaw = process.env["CHAVE_PRIVADA_DO_GOOGLE"];
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

// (Opcional) Log básico para debug em ambientes de teste
console.log("EFETIVIDADE ENV CHECK:", {
  hasEmail: !!serviceAccountEmail,
  hasKey: !!privateKeyRaw,
  hasSpreadsheet: !!spreadsheetId,
});

// Corrige quebras de linha da chave privada
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação com a Service Account
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Nome da aba e da coluna de loja na planilha Efetividade
const ABA_BASE = "BASE_DADOS";
const NOME_COL_LOJA = "LOJA";

export default async function handler(req, res) {
  // Só aceita GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Validação das variáveis de ambiente
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
    // Lê toda a aba BASE_DADOS (ajuste o range se precisar de mais colunas)
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

    // Primeira linha = cabeçalho; demais = linhas
    const cabecalho = values[0];
    const linhas = values.slice(1);

    // Índice da coluna LOJA
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
