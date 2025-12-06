// api/efetividade-lancar.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação via service account para escrever na planilha
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

const ABA_LANCADOS = "LANCADOS";

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Verifica variáveis de ambiente obrigatórias
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
      loja,         // loja logada (não é gravada na linha, só usada para controle)
      usuario,      // usuário logado (idem)
      observacao,   // texto opcional
    } = req.body || {};

    // Precisa vir a linha selecionada para manter a correspondência de colunas
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

    // Observação AGORA É OPCIONAL – não valida mais vazio

    // Data/hora em Brasília, formato "dd/MM/yyyy HH:mm" (sem vírgula, sem segundos)
    const agora = new Date();

    const dataBr = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(agora);

    const horaBr = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(agora);

    const dataHora = `${dataBr} ${horaBr}`; // Ex.: "06/12/2025 11:18"

    /*
      NOVO LAYOUT DA ABA BASE_DADOS (índices do array registroBase):

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

    const [
      ean = "",
      secao = "",
      pendenteVerificadoBase = "", // não será usado diretamente, vamos gravar sempre "Verificado"
      empresaProduto = "",
      codigoProduto = "",
      qtdDisponivel = "",
      precoVdaUnitario = "",
      custoLiqUnitario = "",
      qtdPendente = "",
      diasEstoque = "",
      diasUltimaEntrada = "",
      diasSemVendas = "",
    ] = registroBase;

    // Pendente/Verificado no LANCADOS -> sempre "Verificado"
    const pendenteVerificadoSaida = "Verificado";

    /*
      NOVA ORDEM PARA A ABA LANCADOS:

      1. EAN
      2. Seção
      3. Pendente/Verificado (sempre "Verificado")
      4. Empresa : Produto
      5. Código Produto
      6. Quantidade Disponível
      7. Preço Vda Unitário
      8. Custo Liq. Unitário
      9. Qtd. Pend. Ped.Compra
      10. Dias de Estoque
      11. Dias Ult. Entrada
      12. Qtd. Dias Sem Vendas
      13. Observação
      14. Data/Hora (dd/MM/yyyy HH:mm)
    */

    const linha = [
      ean,
      secao,
      pendenteVerificadoSaida,
      empresaProduto,
      codigoProduto,
      qtdDisponivel,
      precoVdaUnitario,
      custoLiqUnitario,
      qtdPendente,
      diasEstoque,
      diasUltimaEntrada,
      diasSemVendas,
      observacao || "",
      dataHora,
    ];

    // Append na aba LANCADOS
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
