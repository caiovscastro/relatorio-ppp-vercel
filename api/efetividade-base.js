// api/efetividade-base.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação via service account para LER a planilha
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets.readonly"]
);

const sheets = google.sheets({ version: "v4", auth });

const ABA_BASE = "BASE_DADOS";

export default async function handler(req, res) {
  // Só aceita GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Verificação de variáveis de ambiente
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID_EFETIVIDADE.",
    });
  }

  try {
    // loja vem da query, ex.: ULT01-PLANDF
    const lojaParam = (req.query.loja || "").trim().toUpperCase();

    // Lê a base sem o cabeçalho: A2 até L (12 colunas, conforme seu print)
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
      [3] Empresa : Produto   (Ex.: "ULT01-PLANDF : ABS 14UN INTIMUS ...")
      [4] Código Produto
      [5] Quantidade Disponível
      [6] Preço Vda Unitário
      [7] Custo Liq. Unitário
      [8] Qtd. Pend. Ped.Compra
      [9] Dias de Estoque
      [10] Dias Ult. Entrada
      [11] Quantidade Dias Sem Vendas
    */

    // Se não vier loja, devolve tudo (mas o front SEMPRE manda)
    let registrosFiltrados = linhas;

    if (lojaParam) {
      registrosFiltrados = linhas.filter((linha) => {
        const empresaProduto = String(linha[3] ?? "");      // "ULT01-PLANDF : PRODUTO"
        const prefixo = empresaProduto.split(" : ")[0].trim().toUpperCase();
        return prefixo === lojaParam;
      });
    }

    return res.status(200).json({
      sucesso: true,
      registros: registrosFiltrados,
    });
  } catch (erro) {
    console.error("Erro em /api/efetividade-base:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao carregar base de dados.",
      detalhe: erro.message,
    });
  }
}
