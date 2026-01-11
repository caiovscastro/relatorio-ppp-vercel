// /api/carrinhos.js
//
// Grava contagem de carrinhos na aba CARRINHOS do Google Sheets.
//
// ✅ MODELO ATUAL (A..S):
// A: Data/Hora da rede (servidor - São Paulo)
// B: Loja (da sessão)
// C: Usuário (da sessão)
// D: Data Contagem (formato "DD/MM/AAAA")
//
// Tipos / contagens (E em diante):
// E: Duplocar 120L
// F: Grande 160L
// G: Bebê conforto 160L
// H: Maxcar 200L
// I: Macrocar 300L
// J: Prancha Jacaré
// K: Compra Kids
// L: Bebê Jipinho
// M: Cestinha
// N: Cadeira de rodas
// O: Carrinhos Quebrados
//
// ✅ Reservas:
// P: Carrinhos de reserva
// Q: Cestinhas de reserva
//
// ✅ Movimentação:
// R: Movimentação de carrinhos (entrada positivo / saída negativo)
//    - Vem do front como contagens.movCarrinhos
//    - NÃO é contagem física, é ajuste de rastreabilidade
//
// ✅ Coluna S (Motivo / Tipo de movimentação):
// S: Motivo abreviado (ex.: "M.L" | "M.M")
//    - Front continua enviando o código canônico (MOVI_ENTRE_LOJAS | MOVI_MANUTENCAO)
//    - Backend valida o código e grava abreviado na planilha
//
// Segurança:
// - Exige sessão válida via cookie HttpOnly (requireSession)
// - Restringe perfis: ADMINISTRADOR, GERENTE_PPP, BASE_PPP
// - Não confia em loja/usuario vindos do front

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

const PERFIS_PERMITIDOS = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

/**
 * Valores aceitos para o seletor de "Tipo de movimentação" (código canônico).
 * A interface pode mostrar rótulos amigáveis, mas o backend valida e controla.
 */
const MOV_CATEGORIAS_PERMITIDAS = new Set([
  "MOVI_ENTRE_LOJAS",
  "MOVI_MANUTENCAO",
]);

/**
 * ✅ NOVO: abreviação para gravar na coluna S.
 * Regras solicitadas:
 * - "MOVI_ENTRE_LOJAS" => "M.L"
 * - "MOVI_MANUTENCAO"  => "M.M"
 */
function abreviarMovCategoria(canon) {
  if (canon === "MOVI_ENTRE_LOJAS") return "M.L";
  if (canon === "MOVI_MANUTENCAO") return "M.M";
  return "";
}

function nowSaoPaulo() {
  const agora = new Date();
  return new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function formatarDataHoraBR(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Valida "DD/MM/AAAA"
function isBRDateDDMMAAAA(s) {
  const str = String(s || "").trim();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;

  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);

  if (yyyy < 2000 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;

  const maxDia = new Date(yyyy, mm, 0).getDate();
  if (dd < 1 || dd > maxDia) return false;

  return true;
}

// Inteiro obrigatório (>=0, sem decimal) — usado para CONTAGEM
function asIntObrigatorioNaoNegativo(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

// Inteiro obrigatório (pode ser negativo) — usado para MOVIMENTAÇÃO
function asIntObrigatorioComSinal(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/**
 * Normaliza e valida o "tipo de movimentação" vindo do front.
 * Regras:
 * - Se vier vazio/undefined/null => assume MOVI_ENTRE_LOJAS (padrão seguro)
 * - Se vier um valor fora da lista => rejeita (400), para evitar "sujeira" na coluna S
 */
function validarMovCategoria(raw) {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return { ok: true, value: "MOVI_ENTRE_LOJAS" };
  if (!MOV_CATEGORIAS_PERMITIDAS.has(v)) return { ok: false, value: "" };
  return { ok: true, value: v };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Sessão + perfis permitidos
  const session = requireSession(req, res, { allowedProfiles: PERFIS_PERMITIDOS });
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração do servidor incompleta (credenciais/planilha).",
    });
  }

  try {
    const body = req.body || {};
    const dataLancamento = String(body.dataLancamento || "").trim();
    const contagens = body.contagens || {};

    // ✅ Valida categoria do movimento (front envia o CÓDIGO)
    const movCategoriaValid = validarMovCategoria(body.movCategoria);
    if (!movCategoriaValid.ok) {
      return res.status(400).json({
        sucesso: false,
        message: "Tipo de movimentação inválido. Use: MOVI_ENTRE_LOJAS ou MOVI_MANUTENCAO.",
      });
    }
    const movCategoriaCanonica = movCategoriaValid.value;

    // ✅ NOVO: valor que vai para a coluna S (abreviado)
    const movCategoriaAbreviada = abreviarMovCategoria(movCategoriaCanonica);

    // Data Contagem precisa estar em "DD/MM/AAAA"
    if (!isBRDateDDMMAAAA(dataLancamento)) {
      return res.status(400).json({ sucesso: false, message: "Data Contagem inválida. Use DD/MM/AAAA." });
    }

    /*
      ✅ MAPEAMENTO (E..S)

      E  duplocar120
      F  grande160
      G  bebeConforto160
      H  maxcar200
      I  macrocar300
      J  pranchaJacare
      K  compraKids
      L  bebeJipinho
      M  cestinha
      N  cadeiraRodas
      O  carrinhosQuebrados
      P  carrinhosReserva
      Q  cestinhasReserva
      R  movCarrinhos          (pode ser negativo)
      S  movCategoriaAbreviada ("M.L" | "M.M")
    */

    // CONTAGEM (não-negativo)
    const duplocar120        = asIntObrigatorioNaoNegativo(contagens.duplocar120);
    const grande160          = asIntObrigatorioNaoNegativo(contagens.grande160);
    const bebeConforto160    = asIntObrigatorioNaoNegativo(contagens.bebeConforto160);
    const maxcar200          = asIntObrigatorioNaoNegativo(contagens.maxcar200);
    const macrocar300        = asIntObrigatorioNaoNegativo(contagens.macrocar300);
    const pranchaJacare      = asIntObrigatorioNaoNegativo(contagens.pranchaJacare);
    const compraKids         = asIntObrigatorioNaoNegativo(contagens.compraKids);
    const bebeJipinho        = asIntObrigatorioNaoNegativo(contagens.bebeJipinho);
    const cestinha           = asIntObrigatorioNaoNegativo(contagens.cestinha);
    const cadeiraRodas       = asIntObrigatorioNaoNegativo(contagens.cadeiraRodas);
    const carrinhosQuebrados = asIntObrigatorioNaoNegativo(contagens.carrinhosQuebrados);
    const carrinhosReserva   = asIntObrigatorioNaoNegativo(contagens.carrinhosReserva);
    const cestinhasReserva   = asIntObrigatorioNaoNegativo(contagens.cestinhasReserva);

    // MOVIMENTAÇÃO (inteiro com sinal)
    // ✅ Se o front mandar 0/""/undefined, vira 0 (aceito)
    const movCarrinhosRaw =
      (contagens.movCarrinhos === "" || contagens.movCarrinhos === undefined || contagens.movCarrinhos === null)
        ? 0
        : contagens.movCarrinhos;

    const movCarrinhos = asIntObrigatorioComSinal(movCarrinhosRaw);

    const obrigatorios = [
      duplocar120,
      grande160,
      bebeConforto160,
      maxcar200,
      macrocar300,
      pranchaJacare,
      compraKids,
      bebeJipinho,
      cestinha,
      cadeiraRodas,
      carrinhosQuebrados,
      carrinhosReserva,
      cestinhasReserva,
      movCarrinhos, // pode ser negativo, mas não pode ser NaN / decimal
    ];

    if (obrigatorios.some((v) => v === null)) {
      return res.status(400).json({
        sucesso: false,
        message: "Preencha as contagens com números inteiros (sem ponto e sem vírgula). Movimentação pode ser negativa.",
      });
    }

    // Dados de sessão (não confiar no front)
    const loja = String(session.loja || "").trim();
    const usuario = String(session.usuario || "").trim();
    const perfil = String(session.perfil || "").trim().toUpperCase();

    if (!loja || !usuario) {
      return res.status(401).json({ sucesso: false, message: "Sessão inválida (loja/usuário ausentes)." });
    }

    if (!PERFIS_PERMITIDOS.includes(perfil)) {
      return res.status(403).json({ sucesso: false, message: "Perfil sem permissão para esta operação." });
    }

    // Data/hora do servidor (SP)
    const dtRede = nowSaoPaulo();
    const dataHoraRede = formatarDataHoraBR(dtRede);

    // Linha a gravar (A..S)
    const values = [[
      dataHoraRede,           // A
      loja,                   // B
      usuario,                // C
      dataLancamento,         // D

      duplocar120,            // E
      grande160,              // F
      bebeConforto160,        // G
      maxcar200,              // H
      macrocar300,            // I
      pranchaJacare,          // J
      compraKids,             // K
      bebeJipinho,            // L
      cestinha,               // M
      cadeiraRodas,           // N
      carrinhosQuebrados,     // O

      carrinhosReserva,       // P
      cestinhasReserva,       // Q

      movCarrinhos,           // R (entrada + / saída -)
      movCategoriaAbreviada,  // S (M.L | M.M)
    ]];

    const sheets = await getSheetsClient();

    // ✅ Range atualizado para A:S (agora gravamos coluna S)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "CARRINHOS!A:S",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Contagem de carrinhos enviada com sucesso.",
    });
  } catch (erro) {
    console.error("Erro em /api/carrinhos:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao gravar contagem de carrinhos.",
      detalhe: erro?.message || String(erro),
    });
  }
}

/*
  Fontes confiáveis:
  - Google Sheets API (append values): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
  - google-api-nodejs-client (JWT auth / Sheets): https://github.com/googleapis/google-api-nodejs-client
  - Date + timeZone (toLocaleString): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString
*/
