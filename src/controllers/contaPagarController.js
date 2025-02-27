const Ticket = require("../models/Ticket");
const BaseOmie = require("../models/BaseOmie");
const { consultar } = require("../services/omie/contaPagarService");
const ContaPagar = require("../models/ContaPagar");

const obterContaPagarOmie = async (req, res) => {
  try {
    const { codigoLancamento } = req.params;

    const contaPagar = await ContaPagar.findOne({
      codigo_lancamento_omie: codigoLancamento,
    });

    const ticket = await Ticket.findOne({ contaPagarOmie: contaPagar?._id });
    if (!ticket) {
      return res
        .status(404)
        .json({ mensagem: "Ticket com a conta a pagar não encontrado." });
    }
    // console.log("Ticket encontrado:", ticket);

    const baseOmie = await BaseOmie.findOne();
    // console.log("Base Omie encontrada:", baseOmie);

    const { appKey, appSecret } = baseOmie;
    if (!appKey || !appSecret)
      return res
        .status(400)
        .json({ mensagem: "Credenciais Base Omie não encontradas." });

    // Consultar a conta a pagar na Omie usando o serviço de consulta
    const contaPagarOmie = await consultar(appKey, appSecret, codigoLancamento);
    // console.log("Conta a pagar Omie encontrada:", contaPagarOmie);

    if (!contaPagarOmie) {
      ticket.status = "revisao";
      ticket.etapa = "aprovacao-pagamento";
      ticket.contaPagarOmie = null;
      ticket.observacao = "[CONTA A PAGAR REMOVIDA DO OMIE]";

      await ticket.save();

      await ContaPagar.findOneAndDelete({
        codigo_lancamento_omie: codigoLancamento,
      });

      return res.status(404).json({
        mensagem: `Conta a pagar não encontrada! [${codigoLancamento}]`,
        erro: "CONTA A PAGAR NÃO ENCONTRADA NO OMIE",
      });
    }

    // Verificar se o status do título é "PAGO"
    if (contaPagarOmie.status_titulo === "PAGO") {
      // Alterar o status do ticket para "concluído"

      ticket.status = "concluido";
      ticket.etapa = "concluido";
      await ticket.save();
    }

    contaPagar.status_titulo = contaPagarOmie?.status_titulo;
    await contaPagar.save();

    return res.status(200).json(contaPagarOmie);
  } catch (error) {
    console.error("❌ Erro ao obter conta a pagar Omie:", error);
    return res.status(500).json({
      mensagem: "Erro ao obter conta a pagar Omie.",
      erro: error.message,
    });
  }
};

const contaPagarWebHook = async (req, res) => {
  try {
    console.log("--", req.body);

    const { event, ping, topic } = req.body;
    if (ping === "omie") return res.status(200).json({ message: "pong" });

    if (topic === "Financas.ContaPagar.Alterado") {
      console.log("🟩 Conta a pagar alterada");

      await ContaPagar.findOneAndUpdate(
        {
          codigo_lancamento_omie: event?.codigo_lancamento_omie,
        },
        {
          status_titulo: event?.situacao,
        },
        { new: true }
      );
    }

    if (topic === "Financas.ContaPagar.BaixaRealizada") {
      console.log("🟨 Baixa realizada no omie");

      const contaPagar = await ContaPagar.findOne({
        codigo_lancamento_omie:
          event?.[0]?.conta_a_pagar[0].codigo_lancamento_omie,
      });

      await Ticket.findOneAndUpdate(
        {
          contaPagarOmie: contaPagar?._id,
        },
        {
          status: "concluido",
          etapa: "concluido",
        },
        { new: true }
      );
    }

    if (topic === "Financas.ContaPagar.BaixaCancelada") {
      console.log("🟧 Baixa cancelada no omie");

      const contaPagar = await ContaPagar.findOne({
        codigo_lancamento_omie:
          event?.[0]?.conta_a_pagar[0].codigo_lancamento_omie,
      });

      await Ticket.findOneAndUpdate(
        {
          contaPagarOmie: contaPagar?._id,
        },
        {
          status: "trabalhando",
          etapa: "integracao-omie",
        },
        { new: true }
      );
    }

    if (topic === "Financas.ContaPagar.Excluido") {
      console.log("🟥 Conta pagar excluída no omie");

      const contaPagar = await ContaPagar.findOneAndDelete({
        codigo_lancamento_omie: event?.codigo_lancamento_omie,
      });

      await Ticket.findOneAndUpdate(
        {
          contaPagarOmie: contaPagar?._id,
        },
        {
          status: "revisao",
          etapa: "aprovacao-pagamento",
          contaPagarOmie: null,
          observacao: "[CONTA A PAGAR REMOVIDA DO OMIE]",
        }
      );
    }

    res.status(200).json({ message: "Webhook recebido. Fatura sendo gerada." });
  } catch (error) {
    console.error("Erro ao processar o webhook:", error);
    res.status(500).json({ error: "Erro ao processar o webhook." });
  }
};

module.exports = { obterContaPagarOmie, contaPagarWebHook };
