async function createOrder({ order, product }) {
  await new Promise(r => setTimeout(r, 120));
  return {
    ok:true,
    providerOrderId:`DEMO-${Date.now()}`,
    status:"completed",
    message:"Demo provider completed the order"
  };
}
async function getOrderStatus({ order }) {
  await new Promise(r => setTimeout(r, 80));
  return {
    ok:true,
    status: order.status === "failed" ? "failed" : "completed",
    message:"Demo provider status synchronized"
  };
}
module.exports = { createOrder, getOrderStatus };
