// API/efetividade-base.js
// Lê a aba BASE_DADOS da planilha de Efetividade, filtrando pela LOJA (coluna C)

import { google } from "googleapis";

// -----------------------------------------------------------------------------
// Helper: lê variáveis de ambiente com nomes novos e legados e normaliza a chave.
// Estrutura da aba BASE_DADOS (colunas A:J), usada como referência na filtragem:
// A: EAN | B: COD - PRODUTO | C: LOJAS | D: SEÇÕES | E: ESTOQUE DISPONIVEL
// F: CUSTO L. | G: Qtd. Pend. Ped.Compra | H: Dias de Estoque
// I: Dias Ult. Entrada | J: Quantidade Dias Sem Vendas
// -----------------------------------------------------------------------------
function getEnv() {
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];

  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY || process.env["CHAVE_PRIVADA_DO_GOOGLE"];

  // 1) Preferimos o ID dedicado de Efetividade.
  // 2) Aceitamos o ID genérico como compatibilidade com configurações antigas.
  const spreadsheetId =
    process.env.SPREADSHEET_ID_EFETIVIDADE ||
    process.env.ID_DA_PLANILHA_EFETIVIDADE ||
    process.env.SPREADSHEET_ID ||
    process.env.ID_DA_PLANILHA;

  if (!serviceAccountEmail || !privateKeyRaw || !spreadsheetId) {
    throw new Error(
      "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL / E-MAIL DA CONTA DE SERVIÇO DO GOOGLE, " +
        "GOOGLE_PRIVATE_KEY / CHAVE_PRIVADA_DO_GOOGLE e o ID da planilha (SPREADSHEET_ID_EFETIVIDADE, ID_DA_PLANILHA_EFETIVIDADE ou SPREADSHEET_ID)."
    );
  }

  return {
    serviceAccountEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    spreadsheetId,
  };
}

// Cria e autoriza o cliente do Google Sheets (opcionalmente usando config já lida)
async function getSheetsClient(configFromHandler) {
  const { serviceAccountEmail, privateKey } = configFromHandler || getEnv();

  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// Nome da aba na planilha Efetividade
const ABA_BASE = "BASE_DADOS";
// Índice da coluna da LOJA: A=0, B=1, C=2
const IDX_COL_LOJA = 2;

export default async function handler(req, res) {
  // Só aceita GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Garante variáveis de ambiente válidas antes da requisição.
  let config;
  try {
    config = getEnv();
  } catch (erro) {
    console.error("Configuração ausente na Efetividade:", erro);
    return res.status(500).json({
      sucesso: false,
      message: erro.message,
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
    const { spreadsheetId } = config;
    const sheets = await getSheetsClient(config);

    // Lê a aba BASE_DADOS de A:J (10 colunas)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${ABA_BASE}!A:J`,
    });

    const values = resp.data.values || [];
    if (!values.length) {
      return res.status(200).json({
        sucesso: true,
        registros: [],
        message: "Nenhum dado encontrado em BASE_DADOS.",
      });
    }

    // Considero a primeira linha como cabeçalho (mesmo que não use)
    const linhas = values.slice(1);

    // Filtra apenas registros da loja (coluna C = índice 2)
    const filtrados = linhas.filter((linha) => {
      const valorLoja = String(linha[IDX_COL_LOJA] || "").trim();
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
