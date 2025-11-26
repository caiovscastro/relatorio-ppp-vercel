// API/produtos.js
//
// Rota GET /api/produtos
//
// Objetivo:
//  - Ler produtos da planilha Google (aba BASE, colunas A..I)
//  - Opcionalmente filtrar pela loja (?loja=ULT%2001%20-%20PLANALTINA)
//  - Retornar JSON com a lista de produtos.
//
// IMPORTANTE:
//  - Substitua SPREADSHEET_ID pelo ID REAL da sua planilha.
//  - Substitua GOOGLE_API_KEY pela sua API KEY gerada no Google Cloud Console.
//  - Certifique-se de que a Google Sheets API está ativada no projeto do Cloud.

// ID da planilha (aquele código grande na URL do Google Sheets)
const SPREADSHEET_ID = "COLOQUE_AQUI_O_ID_DA_SUA_PLANILHA";

// Sua API Key do Google Cloud (com acesso à Google Sheets API)
const GOOGLE_API_KEY = "COLOQUE_AQUI_SUA_API_KEY";

// Nome da aba que contém a BASE de produtos
const SHEET_NAME = "BASE";

// Função handler usada pela Vercel para a rota /api/produtos
export default async function handler(req, res) {
  // Só aceitamos método GET nesta rota
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  try {
    // Lê parâmetro opcional de loja na query string
    const { loja } = req.query;

    // Monta o range que vamos ler: BASE!A2:I
    //  - A2:I = dados da linha 2 até o final, colunas A..I
    const range = `${encodeURIComponent(SHEET_NAME)}!A2:I`;

    // Monta a URL da Google Sheets API (método values.get)
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}` +
      `/values/${range}?key=${GOOGLE_API_KEY}`;

    // Faz requisição para a API do Google
    const resposta = await fetch(url);

    if (!resposta.ok) {
      const textoErro = await resposta.text().catch(() => "");
      console.error("Erro HTTP ao acessar Sheets API:", resposta.status, textoErro);

      return res.status(500).json({
        sucesso: false,
        message: "Erro ao acessar Google Sheets API.",
        statusGoogle: resposta.status,
        detalhe: textoErro
      });
    }

    // Interpreta o JSON retornado
    const data = await resposta.json();

    // data.values deve ser um array de arrays: [ [A,B,C,D,E,F,G,H,I], ... ]
    const values = data.values || [];

    if (values.length === 0) {
      // Não há dados (só cabeçalho na planilha)
      return res.status(200).json({
        sucesso: true,
        produtos: []
      });
    }

    // Se loja não foi informada, retornamos todas as linhas
    let filtrados = values;

    if (loja && String(loja).trim() !== "") {
      const lojaAlvo = String(loja).trim();

      // Coluna I (índice 8) é a loja
      filtrados = values.filter(linha => {
        const lojaLinha = String(linha[8] || "").trim();
        return lojaLinha === lojaAlvo;
      });
    }

    // Retornamos os dados como vieram da planilha (A..I)
    // Se quiser, mais tarde, podemos padronizar para objetos { ean, cod, produto, ... }
    return res.status(200).json({
      sucesso: true,
      produtos: filtrados
    });
  } catch (erro) {
    console.error("Erro inesperado em /api/produtos:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno na API de produtos.",
      detalhe: erro?.message || String(erro)
    });
  }
}
