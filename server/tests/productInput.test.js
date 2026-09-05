const test=require("node:test");
const assert=require("node:assert/strict");
const {sanitizeProductInputSchema,sanitizeProviderInputMap,validateCustomerData}=require("../lib/productInput");

test("product input schema validates multi-field API customer data",()=>{
  const inputSchema=sanitizeProductInputSchema([
    {key:"playerId",label:"Player ID",required:true,maxLength:32},
    {key:"zoneId",label:"Zone ID",required:true,type:"number",min:1,max:999999}
  ]);
  const product={inputSchema};
  const result=validateCustomerData(product,{playerId:" 778899 ",zoneId:"42"});
  assert.deepEqual(result.customerData,{playerId:"778899",zoneId:"42"});
  assert.equal(result.customerInput,"778899");
});

test("product input schema rejects missing or unknown fields",()=>{
  const product={inputSchema:[{key:"playerId",label:"Player ID",required:true}]};
  assert.throws(()=>validateCustomerData(product,{}),/customer_field_required:playerId/);
  assert.throws(()=>validateCustomerData(product,{playerId:"1",secret:"x"}),/customer_field_unknown:secret/);
});

test("provider input map only accepts configured product fields",()=>{
  const schema=sanitizeProductInputSchema([{key:"playerId",label:"Player ID"},{key:"zoneId",label:"Zone ID"}]);
  assert.deepEqual(sanitizeProviderInputMap({playerId:"player_id",zoneId:"data.zone_id"},schema),{playerId:"player_id",zoneId:"data.zone_id"});
  assert.throws(()=>sanitizeProviderInputMap({email:"email"},schema),/invalid_provider_input_map_key/);
});

test("empty input schema supports products that need no customer data",()=>{
  const product={inputSchema:[]};
  const result=validateCustomerData(product,{});
  assert.deepEqual(result.customerData,{});
  assert.equal(result.customerInput,"");
});
