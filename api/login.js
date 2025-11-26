export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const { usuario, senha, loja } = req.body;

  if (!usuario || !senha || !loja) {
    return res.status(400).json({ erro: "Parâmetros inválidos" });
  }

  if (usuario === "LOJA1" && senha === "123" && loja === "ULT 01 - PLANALTINA") {
    return res.status(200).json({ mensagem: "Login autorizado" });
  }

  return res.status(401).json({ erro: "Login inválido" });
}
