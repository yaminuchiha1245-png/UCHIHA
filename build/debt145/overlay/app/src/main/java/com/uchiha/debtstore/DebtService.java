package com.uchiha.debtstore;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Service credentials are native-only and excluded from customer ledger backups. */
final class DebtService {
    interface Codec { String encrypt(String value) throws Exception; String decrypt(String value) throws Exception; }
    private final SharedPreferences prefs;
    private final Codec codec;
    private final String endpoint;
    private final String publishableKey;
    private final Set<String> allowed = new HashSet<>(Arrays.asList("activate","status","consent","backup","backups","download",
        "owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit"));

    DebtService(Context context, Codec codec, String endpoint, String publishableKey) {
        this.prefs=context.getSharedPreferences("uchiha_service_session_v145",Context.MODE_PRIVATE);
        this.codec=codec; this.endpoint=endpoint; this.publishableKey=publishableKey;
    }
    private synchronized String deviceId() throws Exception {
        String id=prefs.getString("installation_id",null);
        if(id==null){id=UUID.randomUUID().toString();if(!prefs.edit().putString("installation_id",id).commit())throw new Exception("PERSISTENCE_FAILED");}
        return id;
    }
    private synchronized JSONObject session() {
        String encrypted=prefs.getString("session",null);
        if(encrypted==null||encrypted.isEmpty())return new JSONObject();
        try{return new JSONObject(codec.decrypt(encrypted));}
        catch(Exception ignored){
            // A rotated/invalid service session must not prevent reactivation.
            prefs.edit().remove("session").commit();
            return new JSONObject();
        }
    }
    synchronized JSONObject status() {
        try {
            JSONObject saved=session();
            JSONObject cached=saved.optJSONObject("status");
            JSONObject out=cached==null?new JSONObject():new JSONObject(cached.toString());
            out.put("available",true);
            return out;
        }
        catch(Exception e){JSONObject out=new JSONObject();try{out.put("available",true).put("active",false);}catch(Exception ignored){}return out;}
    }
    private synchronized void persist(JSONObject value) throws Exception {
        if(!prefs.edit().putString("session",codec.encrypt(value.toString())).commit())throw new Exception("PERSISTENCE_FAILED");
    }
    JSONObject request(String action, String arguments) throws Exception {
        if(!allowed.contains(action))throw new Exception("INVALID_ACTION");
        JSONObject args=new JSONObject(arguments==null?"{}":arguments);
        JSONObject saved=session();
        String token=saved.optString("token","");
        if(!"activate".equals(action)&&token.isEmpty())return error("SESSION_REQUIRED");
        if("activate".equals(action))args.put("device_label",Build.MANUFACTURER+" "+Build.MODEL);
        JSONObject body=new JSONObject().put("action",action).put("device_id",deviceId()).put("args",args);
        byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>6*1024*1024)return error("BODY_TOO_LARGE");
        HttpURLConnection conn=(HttpURLConnection)new URL(endpoint).openConnection();
        try {
            conn.setConnectTimeout(15000);conn.setReadTimeout(35000);conn.setRequestMethod("POST");
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Content-Type","application/json");
            conn.setRequestProperty("Accept","application/json");
            conn.setRequestProperty("apikey",publishableKey);
            if(!token.isEmpty()&&!"activate".equals(action))conn.setRequestProperty("x-uchiha-session",token);
            conn.setDoOutput(true);conn.setFixedLengthStreamingMode(bytes.length);
            try(OutputStream out=conn.getOutputStream()){out.write(bytes);}
            int code=conn.getResponseCode();
            InputStream stream=code>=200&&code<300?conn.getInputStream():conn.getErrorStream();
            if(stream==null)return error("SERVICE_UNAVAILABLE");
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            try(InputStream in=stream){byte[] chunk=new byte[8192];int count;while((count=in.read(chunk))!=-1){if(out.size()+count>7*1024*1024)throw new Exception("BODY_TOO_LARGE");out.write(chunk,0,count);}}
            JSONObject result=new JSONObject(out.toString("UTF-8"));
            if(result.optBoolean("ok",false)){
                if("activate".equals(action)){
                    String fresh=result.optString("session_token","");
                    if(!fresh.matches("[a-f0-9]{64}"))return error("SERVICE_UNAVAILABLE");
                    result.remove("session_token");
                    saved=new JSONObject().put("token",fresh).put("status",new JSONObject(result.toString()));
                    persist(saved);
                }else if("status".equals(action)){
                    saved.put("status",new JSONObject(result.toString()));persist(saved);
                }else if("consent".equals(action)||"backup".equals(action)){
                    JSONObject meta=saved.optJSONObject("status");if(meta==null)meta=new JSONObject();
                    if("consent".equals(action))meta.put("backup_consent",result.optBoolean("backup_consent",false));
                    if("backup".equals(action))meta.put("last_backup_at",result.optString("created_at",""));
                    saved.put("status",meta);persist(saved);
                }
            }else if("SESSION_REQUIRED".equals(result.optString("error"))){
                JSONObject meta=saved.optJSONObject("status");
                if(meta!=null){meta.put("active",false).put("reauth_required",true);saved.put("status",meta);persist(saved);}
            }
            result.remove("session_token");
            return result;
        }finally{conn.disconnect();}
    }
    static JSONObject error(String message){JSONObject out=new JSONObject();try{out.put("ok",false).put("error",message);}catch(Exception ignored){}return out;}
}
