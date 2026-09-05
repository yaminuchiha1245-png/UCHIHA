class LockTimeoutError extends Error{
  constructor(keys){super("operation_lock_timeout");this.code="operation_lock_timeout";this.keys=keys;}
}

const queues=new Map();
const stats={
  acquired:0,
  released:0,
  timedOut:0,
  maxWaiting:0
};

function normalizeKeys(keys){
  return [...new Set((Array.isArray(keys)?keys:[keys]).map(x=>String(x||"").trim()).filter(Boolean))].sort();
}

function acquireOne(key,{timeoutMs=30000}={}){
  return new Promise((resolve,reject)=>{
    const queue=queues.get(key)||[];
    let settled=false,timer=null;

    const grant=()=>{
      if(settled)return;
      settled=true;
      if(timer)clearTimeout(timer);
      stats.acquired++;
      let released=false;
      resolve(()=>{
        if(released)return;
        released=true;
        stats.released++;
        const q=queues.get(key)||[];
        q.shift();
        if(!q.length)queues.delete(key);
        else q[0]();
      });
    };

    queue.push(grant);
    queues.set(key,queue);
    const waiting=Math.max(0,queue.length-1);
    if(waiting>stats.maxWaiting)stats.maxWaiting=waiting;

    if(queue.length===1)grant();
    else if(timeoutMs>0){
      timer=setTimeout(()=>{
        if(settled)return;
        settled=true;
        stats.timedOut++;
        const q=queues.get(key)||[];
        const idx=q.indexOf(grant);
        if(idx>=0)q.splice(idx,1);
        if(!q.length)queues.delete(key);
        reject(new LockTimeoutError([key]));
      },timeoutMs);
    }
  });
}

async function acquireKeys(keys,{timeoutMs=30000}={}){
  const normalized=normalizeKeys(keys),releases=[];
  const started=Date.now();
  try{
    for(const key of normalized){
      const remaining=timeoutMs>0?Math.max(1,timeoutMs-(Date.now()-started)):0;
      releases.push(await acquireOne(key,{timeoutMs:remaining}));
    }
  }catch(e){
    for(const release of releases.reverse())release();
    if(e instanceof LockTimeoutError)e.keys=normalized;
    throw e;
  }
  let done=false;
  return ()=>{
    if(done)return;
    done=true;
    for(const release of releases.reverse())release();
  };
}

async function withKeyLocks(keys,fn,opts={}){
  const release=await acquireKeys(keys,opts);
  try{return await fn();}
  finally{release();}
}

function lockMiddleware(keyFn,{timeoutMs=30000}={}){
  return async(req,res,next)=>{
    let keys;
    try{keys=normalizeKeys(await keyFn(req));}
    catch(e){return next(e);}
    if(!keys.length)return next();
    let release;
    try{release=await acquireKeys(keys,{timeoutMs});}
    catch(e){
      if(e?.code==="operation_lock_timeout")return res.status(503).json({ok:false,error:"operation_lock_timeout"});
      return next(e);
    }
    let released=false;
    const finish=()=>{
      if(released)return;
      released=true;
      res.off("finish",finish);res.off("close",finish);
      release();
    };
    res.once("finish",finish);res.once("close",finish);
    next();
  };
}

function getLockStats(){
  let activeKeys=0,waiting=0;
  for(const q of queues.values()){
    if(q.length){activeKeys++;waiting+=Math.max(0,q.length-1);}
  }
  return {...stats,activeKeys,waiting};
}

function resetLockStatsForTests(){
  stats.acquired=0;stats.released=0;stats.timedOut=0;stats.maxWaiting=0;
  queues.clear();
}

module.exports={LockTimeoutError,normalizeKeys,acquireKeys,withKeyLocks,lockMiddleware,getLockStats,resetLockStatsForTests};
