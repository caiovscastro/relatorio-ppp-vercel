// api/relatorio-excecao.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação somente leitura (igual à efetividade-base)
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets.readonly"]
);

const sheets = google.sheets({ version: "v4", auth });

const ABA_BASE = "BASE_DADOS";

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

  try {
    const lojaParam = (req.query.loja || "").trim().toUpperCase();
    const statusParam = (req.query.status || "").trim().toUpperCase();
    const secaoParam = (req.query.secao || "").trim().toUpperCase();

    // Lê base sem cabeçalho
    const range = `${ABA_BASE}!A2:L`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const linhas = resp.data.values || [];

    /*
      Layout esperado da BASE_DADOS (por linha):

      [0] EAN
      [1] SECAO
      [2] PENDENTE/VERIFICADO
      [3] Empresa : Produto
      [4] Código Produto
      [5] Quantidade Disponível
      [6] Preço Vda Unitário
      [7] Custo Liq. Unitário
      [8] Qtd. Pend. Ped.Compra
      [9] Dias de Estoque
      [10] Dias Ult. Entrada
      [11] Quantidade Dias Sem Vendas
    */

    let registrosFiltrados = linhas;

    // Filtro por loja (prefixo "ULT01-PLANDF : PRODUTO")
    if (lojaParam) {
      registrosFiltrados = registrosFiltrados.filter((linha) => {
        const empresaProduto = String(linha[3] ?? "");
        const prefixo = empresaProduto.split(" : ")[0].trim().toUpperCase();
        return prefixo === lojaParam;
      });
    }

    // Filtro por status, se informado (PENDENTE / VERIFICADO)
    if (statusParam && statusParam !== "TODOS") {
      registrosFiltrados = registrosFiltrados.filter((linha) => {
        const status = String(linha[2] ?? "").trim().toUpperCase();
        return status === statusParam;
      });
    }

    // Filtro por seção, se informado
    if (secaoParam) {
      registrosFiltrados = registrosFiltrados.filter((linha) => {
        const secao = String(linha[1] ?? "").trim().toUpperCase();
        return secao === secaoParam;
      });
    }

    return res.status(200).json({
      sucesso: true,
      registros: registrosFiltrados,
    });
  } catch (erro) {
    console.error("Erro em /api/relatorio-excecao:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao carregar relatório de exceção.",
      detalhe: erro.message,
    });
  }
}
