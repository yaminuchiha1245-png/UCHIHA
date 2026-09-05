async function createOrder({ order }) {
  return {
    ok: true,
    providerOrderId: null,
    status: "processing",
    message: "Waiting for manual fulfillment"
  };
}
module.exports = { createOrder };
