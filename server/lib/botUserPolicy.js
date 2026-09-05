const RULES=[
  ["GET",/^\/api\/me$/],
  ["GET",/^\/api\/orders$/]
];

function canBotReadCustomer(method,path){
  const m=String(method||"").toUpperCase(),p=String(path||"").split("?")[0];
  return RULES.some(([allowedMethod,re])=>m===allowedMethod&&re.test(p));
}

module.exports={canBotReadCustomer,RULES};
