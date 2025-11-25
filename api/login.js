// api/login.js
// Rota de login da API na Vercel

const loginsPermitidos = [
  {
    usuario: "LOJA1",
    senha: "1234",
    loja: "ULT 01 - PLANALTINA",
  },
  {
    usuario: "LOJA2",
    senha: "abcd",
    loja: "ULT 02 - OUTRA LOJA",
  },
  // Adicione mais combinações aqui conforme precisar
];

export default async function handler(req, res) {
  // Só aceitamos POST
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Método não permitido" });
  }

  let body = req.body || {};

  // Garantir que o body esteja em objeto (caso venha string)
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  const { usuario, senha, loja } = body;

  // Valida se todos foram enviados
  if (!usuario || !senha || !loja) {
    return res
      .status(400)
      .json({ ok: false, message: "Usuário, senha e loja são obrigatórios." });
  }

  const match = loginsPermitidos.find(
    (item) =>
      item.usuario === usuario &&
      item.senha === senha &&
      item.loja === loja
  );

  if (!match) {
    // Combinação inválida
    return res
      .status(401)
      .json({ ok: false, message: "Usuário, senha ou loja inválidos." });
  }

  // Login OK
  return res.status(200).json({
    ok: true,
    message: "Login autorizado.",
  });
}
