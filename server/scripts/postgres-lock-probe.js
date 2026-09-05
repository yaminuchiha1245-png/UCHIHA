try{require("dotenv").config();}catch{}
const {initStore,closeStore}=require("../store");

(async()=>{
  await initStore();
  console.log("PostgreSQL writer lock acquired");
  await closeStore();
})().catch(async e=>{
  console.error(e.message);
  try{await closeStore()}catch{}
  process.exit(e.message==="another_game_zone_server_is_active"?23:1);
});
