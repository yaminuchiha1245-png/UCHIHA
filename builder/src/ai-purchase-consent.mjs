import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

async function validSessionAndCsrf(db, request) {
  const session = request.cookies?.[SESSION_COOKIE];
  const csrf = String(request.headers["x-csrf-token"] || "");
  if (!session || !csrf) return false;
  const row = (
    await db.query(
      `SELECT s.csrf_hash
       FROM sessions s
       JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(session)]
    )
  ).rows[0];
  return Boolean(row?.csrf_hash && sha256(csrf) === row.csrf_hash);
}

export function installAiPurchaseConsent(app, { db }) {
  app.addHook("preHandler", async (request, reply) => {
    if (
      String(request.method || "").toUpperCase() !== "POST" ||
      pathOf(request) !== "/api/platform/ai-bots/purchase"
    ) return;

    // Preserve canonical auth/CSRF responses for invalid sessions.
    if (!(await validSessionAndCsrf(db, request))) return;
    if (request.body?.openAiCostAccepted !== true) {
      return reply.code(422).send({
        error: "openai_cost_consent_required",
        message: "يجب تأكيد أن OpenAI API Key ورصيد OpenAI منفصلان عن سعر شراء البوت"
      });
    }
  });

  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (
      String(request.method || "").toUpperCase() !== "POST" ||
      pathOf(request) !== "/api/platform/ai-bots/purchase" ||
      request.body?.openAiCostAccepted !== true ||
      !payload?.orderId
    ) return payload;

    await db.query(
      `UPDATE platform_catalog_orders
       SET configuration=COALESCE(configuration, '{}'::jsonb) || jsonb_build_object(
             'openAiCostAccepted', TRUE,
             'openAiCostAcceptedAt', NOW()
           ),
           updated_at=NOW()
       WHERE id=$1`,
      [payload.orderId]
    );
    return payload;
  });
}
