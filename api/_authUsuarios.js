// /api/_authUsuarios.js
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import crypto from "crypto";

// =============================================================================
// 1) GOOGLE SHEETS - ENV (com fallback para seus nomes diferentes)
// =============================================================================
function getSheetsEnv() {
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_SERVICE_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_EMAIL;

  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY_RAW ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  const sheetId =
    process.env.SPREADSHEET_ID ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SHEETID ||
    process.env.GOOGLE_PLANILHA_ID;

  if (!serviceAccountEmail || !privateKeyRaw || !sheetId) {
    throw new Error(
      "ENV Google incompleta. Defina GOOGLE_SERVICE_ACCOUNT_EMAIL (ou GOOGLE_SERVICE_EMAIL), " +
      "GOOGLE_PRIVATE_KEY e SPREADSHEET_ID (ou GOOGLE_SHEET_ID)."
    );
  }

  const privateKey = String(privateKeyRaw).replace(/\\n/g, "\n");
  return { serviceAccountEmail, privateKey, sheetId };
}

// =============================================================================
// 2) SESSÃO - CONFIG
// =============================================================================
const SESSION_COOKIE_NAME = "ppp_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 horas

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || String(secret).trim().length < 32) {
    // 32+ recomendado para HMAC forte
    throw new Error(
      "SESSION_SECRET ausente/fraco. Crie uma env SESSION_SECRET com pelo menos 32 caracteres."
    );
  }
  return String(secret);
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecodeToString(b64url) {
  const b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

// Token assinado simples: payloadB64url + "." + sigB64url(HMAC(payloadB64url))
function signToken(payloadObj) {
  const secret = getSessionSecret();
  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = base64urlEncode(payloadJson);

  const sig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest();

  const sigB64 = base64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

function verifyToken(token) {
  try {
    const secret = getSessionSecret();
    if (!token || typeof token !== "string") return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payloadB64, sigB64] = parts;

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payloadB64)
      .digest();

    const expectedSigB64 = base64urlEncode(expectedSig);

    // comparação resistente a timing attacks
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expectedSigB64);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    const payloadJson = base64urlDecodeToString(payloadB64);
    const payload = JSON.parse(payloadJson);

    // exp em segundos (epoch)
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.exp || now >= payload.exp) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (!header) return out;

  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });

  return out;
}

function isProduction(req) {
  // Em Vercel normalmente NODE_ENV=production.
  if (process.env.NODE_ENV === "production") return true;

  // fallback
  const proto = req.headers?.["x-forwarded-proto"];
  return proto === "https";
}

function buildSetCookie(value, req, maxAgeSeconds) {
  const secure = isProduction(req) ? " Secure;" : "";
  return (
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)};` +
    ` Max-Age=${maxAgeSeconds};` +
    ` Path=/;` +
    ` HttpOnly;` +
    ` SameSite=Lax;` +
    secure
  );
}

// =============================================================================
// 3) EXPORTS - LEITURA DE USUÁRIOS
// =============================================================================
export async function lerUsuariosDaPlanilha() {
  try {
    const { serviceAccountEmail, privateKey, sheetId } = getSheetsEnv();

    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();

    const aba = doc.sheetsByTitle["USUARIOS"];
    if (!aba) throw new Error("Aba 'USUARIOS' não encontrada");

    const linhas = await aba.getRows();

    return linhas.map((l) => ({
      usuario: String(l["USUARIO"] || "").trim().toLowerCase(),
      senha: String(l["SENHA"] || "").trim(),
      loja: String(l["LOJAS"] || "").trim().toLowerCase(),
      perfil: String(l["PERFIL"] || "").trim().toUpperCase(),
    }));
  } catch (e) {
    console.error("Erro ao ler usuários:", e);
    return [];
  }
}

// =============================================================================
// 4) EXPORTS - SESSÃO
// =============================================================================
export function createSessionCookie(req, res, { usuario, loja, perfil }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    usuario: String(usuario || "").trim(),
    loja: String(loja || "").trim(),
    perfil: String(perfil || "").trim(),
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };

  const token = signToken(payload);
  res.setHeader("Set-Cookie", buildSetCookie(token, req, SESSION_MAX_AGE_SECONDS));
  return payload;
}

export function clearSessionCookie(req, res) {
  // expira agora
  const expired = buildSetCookie("", req, 0);
  res.setHeader("Set-Cookie", expired);
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  return verifyToken(token);
}

// Guard padrão para APIs: se não tiver sessão -> 401
export function requireSession(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({
      sucesso: false,
      message: "Sessão inválida ou expirada. Efetue login novamente.",
    });
    return null;
  }
  return session;
}
