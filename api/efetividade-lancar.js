// api/efetividade-lancar.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação direta via service account para escrever na planilha
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

const ABA_LANCADOS = "LANCADOS";

export default async function handler(req, res) {
  // Endpoint só aceita POST porque apenas recebe lançamentos
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Garante que variáveis de ambiente obrigatórias estejam presentes
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID_EFETIVIDADE.",
    });
  }

  try {
    const {
      registroBase, // linha completa da aba BASE_DADOS
      loja,         // loja que está logada no front
      usuario,      // usuário logado
      observacao,   // relato digitado (AGORA OPCIONAL)
    } = req.body || {};

    // Precisa vir exatamente a linha selecionada para manter a ordem de colunas
    if (!Array.isArray(registroBase) || !registroBase.length) {
      return res.status(400).json({
        sucesso: false,
        message: "Registro da base (registroBase) inválido.",
      });
    }

    if (!loja || !usuario) {
      return res.status(400).json({
        sucesso: false,
        message: "Loja e usuário são obrigatórios.",
      });
    }

    // >>> BLOCO REMOVIDO <<<
    // Observação não é mais obrigatória:
    // if (!observacao) {
    //   return res.status(400).json({
    //     sucesso: false,
    //     message: "Observação é obrigatória.",
    //   });
    // }

    // Data/hora em Brasília
    const agora = new Date();
    const dataHora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(agora);

    /*
      Montagem da linha (ordem solicitada pelo usuário):
      - EAN
      - Cod/Produto
      - Loja
      - Seção
      - Estoque Disponivel
      - Custo Liquido
      - Qtd. Pend. Ped.Compra
      - Dias de Estoque
      - Dias Ult. Entrada
      - Qtd Dias Sem Vendas
      - Observação (pode vir vazio)
      - Data/Hora

      Qualquer coluna de quantidade/valor/documento foi removida para não ser enviada.
    */
    const [
      ean = "",
      codigoProduto = "",
      lojaBase = "",
      secao = "",
      estoqueDisponivel = "",
      custoLiquido = "",
      qtdPendente = "",
      diasEstoque = "",
      diasUltimaEntrada = "",
      diasSemVendas = "",
    ] = registroBase;

    // Linha final enviada para LANCADOS; ordem exata da listagem acima
    const linha = [
      ean,
      codigoProduto,
      lojaBase,
      secao,
      estoqueDisponivel,
      custoLiquido,
      qtdPendente,
      diasEstoque,
      diasUltimaEntrada,
      diasSemVendas,
      observacao || "", // garante string mesmo se vier undefined/null
      dataHora,
    ];

    // Append na aba LANCADOS sem sobrescrever linhas existentes
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${ABA_LANCADOS}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [linha],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Lançamento registrado com sucesso na base de dados.",
    });
  } catch (erro) {
    console.error("Erro em /api/efetividade-lancar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao registrar lançamento na base de dados.",
      detalhe: erro.message,
    });
  }
}
