// /api/carrinhos-listar.js
// Lê registros da aba CARRINHOS (A:T) e retorna para o dashboard.
//
// Colunas (A..T) — NOVA ORDEM:
// A: Data/Hora da rede (servidor - São Paulo)  -> string (ex: "06/01/2026 10:22:33")
// B: Loja (da sessão no lançamento)            -> string
// C: Usuário (da sessão no lançamento)         -> string
// D: Data Contagem (DD/MM/AAAA)                -> string
// E: Duplocar 120L                             -> int
// F: Grande 160L                               -> int
// G: Bebê conforto 160L                        -> int   (key: bebeConforto160)
// H: Maxcar 200L                               -> int
// I: Macrocar 300L                             -> int
// J: Prancha Jacaré                            -> int
// K: Compra Kids                               -> int
// L: Carrinho gaiola pet                       -> int   (key: gaiolaPet)  ✅ NOVO
// M: Bebê Jipinho                              -> int
// N: Cestinha                                  -> int
// O: Cadeira de rodas                          -> int
// P: Carrinhos Quebrados                       -> int
// Q: Carrinhos reserva                         -> int
// R: Cestinhas reserva                         -> int
// S: Qtd (Quantidade de movimentação)          -> int com sinal (pode ser negativo)
// T: Motivo                                    -> string
//
// ✅ Ajuste solicitado (necessário para o dashboard):
// - Expor "horaRegistro" (HH:MM:SS) extraída da coluna A (dataHoraRede)
// - (extra) Expor "dataRegistro" (DD/MM/AAAA) extraída da coluna A
//
// Segurança:
// - Exige sessão válida via cookie HttpOnly (requireSession)
// - Restringe perfis: ADMINISTRADOR, GERENTE_PPP, BASE_PPP
// - Não expõe credenciais, não aceita parâmetros sensíveis do front

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

const PERFIS_PERMITIDOS = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Converte valor em inteiro >= 0, truncando decimais e tratando inválidos como 0 (para contagens)
function asIntSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

// Converte valor em inteiro COM SINAL, truncando decimais e tratando inválidos como 0 (para movimentação - coluna S)
function asIntSignedSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

/* =========================================================
   ✅ Parse seguro do campo A: "DD/MM/AAAA HH:MM:SS"
   - Retorna { dataBR, horaHMS } ou strings vazias se inválido
   - Isso habilita o front a deduplicar por:
     (Loja + DataContagem) pegando o MAIOR horário (horaRegistro)
   ========================================================= */
function parseDataHoraRedeBR(dataHoraRede) {
  const s = String(dataHoraRede ?? "").trim();

  // Aceita "DD/MM/AAAA HH:MM" ou "DD/MM/AAAA HH:MM:SS"
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return { dataBR: "", horaHMS: "" };

  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];
  const HH = m[4];
  const MM = m[5];
  const SS = (m[6] ?? "00").padStart(2, "0");

  return {
    dataBR: `${dd}/${mm}/${yyyy}`,
    horaHMS: `${HH}:${MM}:${SS}`,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Sessão + perfis permitidos
  const session = requireSession(req, res, { allowedProfiles: PERFIS_PERMITIDOS });
  if (!session) return; // requireSession já responde 401/403

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração do servidor incompleta (credenciais/planilha).",
    });
  }

  try {
    const sheets = await getSheetsClient();

    // ✅ Agora busca A:T (20 colunas)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CARRINHOS!A:T",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return res.status(200).json({ sucesso: true, registros: [] });
    }

    // Se existir cabeçalho, removemos.
    // Heurística: se A1 contém "DATA" (ex: "DATA/HORA"), pula a primeira linha.
    const firstCell = String(values?.[0]?.[0] || "").toUpperCase();
    const startIndex = firstCell.includes("DATA") ? 1 : 0;

    const registros = [];

    for (let i = startIndex; i < values.length; i++) {
      const row = values[i] || [];

      // ✅ Garante 20 colunas (A..T) para evitar undefined em linhas incompletas
      while (row.length < 20) row.push("");

      // Fixos (A..D)
      const dataHoraRede = String(row[0] ?? "").trim(); // A
      const loja         = String(row[1] ?? "").trim(); // B
      const usuario      = String(row[2] ?? "").trim(); // C
      const dataContagem = String(row[3] ?? "").trim(); // D

      // Motivo (T)
      const motivo = String(row[19] ?? "").trim(); // T

      // ✅ NOVO: extrai data e hora a partir da coluna A
      const { dataBR: dataRegistro, horaHMS: horaRegistro } =
        parseDataHoraRedeBR(dataHoraRede);

      // Monta o registro no formato esperado pelo dashboard:
      const rec = {
        dataHoraRede,
        loja,
        usuario,
        dataContagem,

        // ✅ Campos usados no front para deduplicação/ordenamento por timestamp
        horaRegistro, // "HH:MM:SS"
        dataRegistro, // "DD/MM/AAAA"

        // Motivo (compat)
        motivo,
        movCategoria: motivo, // compat com front

        contagens: {
          duplocar120:        asIntSafe(row[4]),   // E
          grande160:          asIntSafe(row[5]),   // F
          bebeConforto160:    asIntSafe(row[6]),   // G
          maxcar200:          asIntSafe(row[7]),   // H
          macrocar300:        asIntSafe(row[8]),   // I
          pranchaJacare:      asIntSafe(row[9]),   // J
          compraKids:         asIntSafe(row[10]),  // K

          // ✅ NOVO: Carrinho gaiola pet (L)
          gaiolaPet:          asIntSafe(row[11]),  // L

          bebeJipinho:        asIntSafe(row[12]),  // M
          cestinha:           asIntSafe(row[13]),  // N
          cadeiraRodas:       asIntSafe(row[14]),  // O
          carrinhosQuebrados: asIntSafe(row[15]),  // P
          carrinhosReserva:   asIntSafe(row[16]),  // Q
          cestinhasReserva:   asIntSafe(row[17]),  // R

          // (S) Qtd (movimentação com sinal)
          movCarrinhos:       asIntSignedSafe(row[18]), // S
        },
      };

      // Descarta linhas totalmente vazias
      if (!rec.dataHoraRede && !rec.loja && !rec.usuario && !rec.dataContagem) continue;

      registros.push(rec);
    }

    return res.status(200).json({
      sucesso: true,
      registros,
    });
  } catch (erro) {
    console.error("Erro em /api/carrinhos-listar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao ler a planilha de carrinhos.",
      detalhe: erro?.message || String(erro),
    });
  }
}

/*
  Fontes confiáveis:
  - Google Sheets API (values.get): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get
  - Google API Node.js Client (JWT): https://github.com/googleapis/google-api-nodejs-client
  - Regex (String.prototype.match): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match
*/
