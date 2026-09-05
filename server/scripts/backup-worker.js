try{require("dotenv").config();}catch{}
const {spawn}=require("node:child_process");
const path=require("node:path");

const backupScript=path.join(__dirname,"backup.js");
const intervalMs=Math.max(60,Number(process.env.BACKUP_INTERVAL_SECONDS||86400))*1000;
const retryMs=Math.max(10,Number(process.env.BACKUP_RETRY_SECONDS||300))*1000;
const maxFailures=Math.max(1,Number(process.env.BACKUP_MAX_CONSECUTIVE_FAILURES||3));
const once=String(process.env.BACKUP_WORKER_ONCE||"false").toLowerCase()==="true";

let stopping=false,activeChild=null,sleepTimer=null,sleepResolve=null;

function runBackup(){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[backupScript],{env:process.env,stdio:"inherit"});
    activeChild=child;
    child.once("exit",(code,signal)=>{
      activeChild=null;
      resolve({ok:code===0,code,signal});
    });
    child.once("error",err=>{
      activeChild=null;
      console.error("Backup worker spawn failed:",err.message);
      resolve({ok:false,code:null,signal:null,error:err});
    });
  });
}

function sleep(ms){
  return new Promise(resolve=>{
    sleepResolve=resolve;
    sleepTimer=setTimeout(()=>{
      sleepTimer=null;sleepResolve=null;resolve();
    },ms);
  });
}

async function main(){
  let failures=0;
  while(!stopping){
    const result=await runBackup();
    if(stopping)break;
    if(result.ok){
      failures=0;
      if(once)return;
      await sleep(intervalMs);
      continue;
    }
    failures++;
    console.error(`Backup worker failure ${failures}/${maxFailures}`);
    if(once||failures>=maxFailures){
      process.exitCode=1;
      return;
    }
    await sleep(retryMs);
  }
}

function shutdown(){
  stopping=true;
  if(sleepTimer){clearTimeout(sleepTimer);sleepTimer=null;}
  if(sleepResolve){const resolve=sleepResolve;sleepResolve=null;resolve();}
  if(activeChild&&!activeChild.killed)activeChild.kill("SIGTERM");
}
process.once("SIGINT",shutdown);
process.once("SIGTERM",shutdown);

main().catch(e=>{console.error(e);process.exitCode=1});
