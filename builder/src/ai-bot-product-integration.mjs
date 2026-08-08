function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
}

async function catalogMetadata(db) {
  try {
    const rows = await db.query(
      `SELECT id, service_key, slug, is_catalog_product, catalog_category_slug,
              catalog_subcategory_slug, product_image_url, order_schema
       FROM platform_services
       WHERE tenant_id IS NULL AND store_id IS NULL AND is_catalog_product=TRUE`
    );
    return new Map(
      rows.rows.map((row) => [row.id, {
        isProduct: true,
        categorySlug: row.service_key === "ai-chatbot" ? "telegram-bots" : row.catalog_category_slug,
        subcategorySlug: row.service_key === "ai-chatbot" ? "ai-bots" : row.catalog_subcategory_slug,
        imageUrl: row.product_image_url || null,
        orderSchema: row.order_schema || {}
      }])
    );
  } catch (error) {
    if (["42P01", "42703"].includes(error?.code)) return new Map();
    throw error;
  }
}

export function installAiBotProductIntegration(app, { db }) {
  app.get("/product/ai-chatbot", async (_request, reply) => reply.sendFile("ai-bot-product.html"));

  app.addHook("preSerialization", async (request, _reply, payload) => {
    const path = requestPath(request);
    if (request.method === "GET" && path === "/api/public/portal" && payload?.services) {
      const catalog = await catalogMetadata(db);
      return {
        ...payload,
        services: payload.services.map((service) => {
          const metadata = catalog.get(service.id);
          return metadata
            ? {
                ...service,
                isCatalogProduct: true,
                catalogCategorySlug: metadata.categorySlug,
                catalogSubcategorySlug: metadata.subcategorySlug,
                productImageUrl: metadata.imageUrl,
                catalog: metadata
              }
            : service;
        })
      };
    }

    // The merchant can see whether the shared AI service is ready, but billing for
    // the platform-owned OpenAI account remains visible only to platform admins.
    if (
      request.method === "GET" &&
      /^\/api\/platform\/ai-bots\/[0-9a-f-]+$/i.test(path) &&
      payload?.openAi
    ) {
      return {
        ...payload,
        openAi: { configured: Boolean(payload.openAi.configured) }
      };
    }
    return payload;
  });
}