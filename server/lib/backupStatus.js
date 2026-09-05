const fs=require("node:fs");
const path=require("node:path");

const STATUS_FILE="backup-status.json";

function statusPath(dir){return path.join(dir,STATUS_FILE);}

function writeBackupStatus(dir,status){
  fs.mkdirSync(dir,{recursive:true});
  const target=statusPath(dir),tmp=`${target}.tmp-${process.pid}-${Date.now()}`;
  const payload={...status,updatedAt:new Date().toISOString()};
  fs.writeFileSync(tmp,JSON.stringify(payload,null,2),"utf8");
  fs.renameSync(tmp,target);
  return payload;
}

function readBackupStatus(dir){
  try{
    const data=JSON.parse(fs.readFileSync(statusPath(dir),"utf8"));
    return data&&typeof data==="object"?data:null;
  }catch{return null;}
}

function listBackupFiles(dir,{limit=50}={}){
  try{
    return fs.readdirSync(dir)
      .filter(name=>/^(game-zone|pre-restore|pre-migration|pre-state-rollback)-.*\.json$/i.test(name))
      .map(name=>{
        const file=path.join(dir,name),st=fs.statSync(file);
        let type="backup";
        if(name.startsWith("pre-restore-"))type="pre-restore";
        else if(name.startsWith("pre-migration-"))type="pre-migration";
        else if(name.startsWith("pre-state-rollback-"))type="pre-state-rollback";
        return {name,type,size:st.size,modifiedAt:st.mtime.toISOString()};
      })
      .sort((a,b)=>String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
      .slice(0,Math.max(1,Math.min(500,Number(limit||50))));
  }catch{return [];}
}

function backupHealth(status,{maxAgeHours=48,nowMs=Date.now(),dir=null}={}){
  if(!status)return {ok:false,reason:"backup_status_missing",ageHours:null};
  if(status.running&&status.ok!==true)return {ok:false,reason:"backup_running_no_success",ageHours:null};
  if(status.ok!==true)return {ok:false,reason:"last_backup_failed",ageHours:null,error:status.error||null};
  if(dir&&status.file){
    const file=path.resolve(dir,String(status.file));
    const root=path.resolve(dir)+path.sep;
    if(!(file+path.sep).startsWith(root)&&file!==path.resolve(dir))return {ok:false,reason:"backup_file_path_invalid",ageHours:null};
    if(!fs.existsSync(file))return {ok:false,reason:"backup_file_missing",ageHours:null};
  }
  const ts=new Date(status.lastSuccessAt||status.completedAt||status.updatedAt||0).getTime();
  if(!Number.isFinite(ts)||ts<=0)return {ok:false,reason:"backup_timestamp_invalid",ageHours:null};
  const ageHours=(nowMs-ts)/3600000;
  if(ageHours>Number(maxAgeHours||48))return {ok:false,reason:"backup_too_old",ageHours:Number(ageHours.toFixed(2))};
  return {ok:true,reason:null,ageHours:Number(Math.max(0,ageHours).toFixed(2))};
}

module.exports={STATUS_FILE,statusPath,writeBackupStatus,readBackupStatus,listBackupFiles,backupHealth};
