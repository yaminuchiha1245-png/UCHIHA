const RULES=[
  ["GET",/^\/api\/admin\/dashboard$/],
  ["GET",/^\/api\/admin\/orders$/],
  ["GET",/^\/api\/admin\/topups$/],
  ["POST",/^\/api\/admin\/topups\/[^/]+\/(?:approve|reject)$/],
  ["GET",/^\/api\/admin\/provider-logs$/],
  ["GET",/^\/api\/admin\/support-tickets$/],
  ["GET",/^\/api\/admin\/inventory\/summary$/],
  ["GET",/^\/api\/admin\/sync-worker$/],
  ["POST",/^\/api\/admin\/sync-worker\/run$/],
  ["POST",/^\/api\/admin\/broadcast$/]
];

function canAutomationAccess(method,path){
  const m=String(method||"").toUpperCase(),p=String(path||"").split("?")[0];
  return RULES.some(([allowedMethod,re])=>m===allowedMethod&&re.test(p));
}

module.exports={canAutomationAccess,RULES};
