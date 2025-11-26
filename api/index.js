// api/index.js
// Endpoint simples de "health-check" da API na Vercel.
// Serve para verificar rapidamente se a função serverless está respondendo.
//
// Quando você acessar: https://SEU-PROJETO.vercel.app/api
// deve receber um JSON como: { "sucesso": true, "message": "API PPP ativa na Vercel." }

export default function handler(req, res) {
    // Aceitamos apenas GET aqui, pois é apenas um teste de status.
    if (req.method !== "GET") {
        // 405 = Method Not Allowed
        return res.status(405).json({
            sucesso: false,
            message: "Método não permitido neste endpoint. Use GET."
        });
    }

    // Se chegou aqui, está tudo certo.
    return res.status(200).json({
        sucesso: true,
        message: "API PPP ativa na Vercel."
    });
}
