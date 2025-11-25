import express from "express";
import { google } from "googleapis";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ---- CONFIGURAÇÃO DO GOOGLE SHEETS ----
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getAuth() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

  if (!privateKey || !clientEmail) {
    throw new Error("Variáveis GOOGLE_PRIVATE_KEY ou GOOGLE_CLIENT_EMAIL ausentes.");
  }

  return new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    SCOPES
  );
}

// ---- ROTA DE LEITURA DE PLANILHA ----
app.get("/api/sheet", async (req, res) => {
  try {
    const spreadsheetId = process.env.SHEET_ID;
    const range = "Página1!A1:Z1000";

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    res.json(result.data.values);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao acessar Google Sheets" });
  }
});

// ---- EXPORTAÇÃO PARA A VERCEL ----
export default app;
