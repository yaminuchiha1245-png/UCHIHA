#!/usr/bin/env python3
"""One-time private terminal setup; no Telegram tokens are stored in source control."""
from __future__ import annotations

import getpass
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE=Path(__file__).resolve().parent
ENV=HERE/".env"
DEFAULT_URL="https://jmluqclcwwuldwhaspgz.supabase.co"
DEFAULT_KEY="sb_publishable_zhOXbcCDipCmq0TGC3kQJA_32IaYRZq"


def load()->dict[str,str]:
    d={}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k,v=line.split("=",1);d[k]=v.strip()
    return d


def ask(label:str,existing:str="",secret:bool=False)->str:
    display=" [اتركه فارغًا للاحتفاظ بالمحفوظ]" if existing else ""
    raw=(getpass.getpass if secret else input)(label+display+": ").strip()
    return raw or existing


def api(url:str,body:dict,headers:dict|None=None,timeout:int=25)->dict:
    if not url.startswith("https://"):
        raise RuntimeError("HTTPS required")
    request=urllib.request.Request(url,data=json.dumps(body).encode(),method="POST",
        headers={"Content-Type":"application/json",**(headers or {})})
    try:
        with urllib.request.urlopen(request,timeout=timeout) as response:
            data=json.loads(response.read(100_000))
        if not isinstance(data,dict):raise RuntimeError("Invalid API response")
        return data
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}; تحقق من عنوان المشروع والمفاتيح والصلاحيات.") from None
    except urllib.error.URLError:
        raise RuntimeError("تعذر الاتصال؛ تحقق من الإنترنت وعنوان المشروع.") from None


def detect_admin(token:str)->int:
    print("أرسل /id إلى البوت الآن من حسابك، ثم اكتب رقم حسابك الظاهر.")
    print("يمكنك أيضًا إرسال /myid إلى @userinfobot لمعرفة رقمك.")
    while True:
        raw=input("Telegram ID للمدير (أرقام فقط): ").strip()
        if raw.isdigit() and int(raw)>0:
            return int(raw)
        print("رقم غير صالح.")


def main()->None:
    os.umask(0o077)
    old=load()
    print("\nUCHIHA — إعداد بوت إدارة تطبيق الديون\n")
    print("لا ترسل توكن البوت أو مفتاح Supabase داخل تلغرام أو المحادثات.")
    token=ask("توكن البوت من BotFather",old.get("BOT_TOKEN",""),True)
    if not re.fullmatch(r"\d{5,20}:[A-Za-z0-9_-]{20,}",token):
        raise SystemExit("التوكن غير صالح شكليًا.")
    result=api("https://api.telegram.org/bot"+token+"/getMe",{})
    if not result.get("ok"):
        raise SystemExit("Telegram رفض التوكن.")
    username=result.get("result",{}).get("username")
    print("✅ توكن صحيح. بوتك: @"+str(username))
    print("لإظهار لوحة الإدارة لحسابك فقط، حدد Telegram ID الرقمي.")
    prev_id=old.get("ADMIN_TELEGRAM_ID","")
    raw=ask("Telegram ID",prev_id)
    if not raw.isdigit() or int(raw)<=0:raise SystemExit("معرف المدير غير صالح.")
    admin_id=int(raw)
    if input(f"تأكيد: المدير الوحيد هو {admin_id}؟ اكتب نعم: ").strip()!="نعم":
        raise SystemExit("توقف الإعداد دون أي تغيير.")
    url=ask("عنوان Supabase",old.get("SUPABASE_URL",DEFAULT_URL))
    if not url.startswith("https://") or not url.endswith(".supabase.co"):
        raise SystemExit("عنوان Supabase غير صالح.")
    pub=ask("مفتاح Supabase العام (publishable)",old.get("SUPABASE_PUBLISHABLE_KEY",DEFAULT_KEY))
    if not (pub.startswith("sb_publishable_") or len(pub)>70):
        raise SystemExit("المفتاح العام غير صالح.")

    # Re-running setup to change BOT_TOKEN does not require reprovisioning,
    # provided the backend admin ID has not changed.
    secret=old.get("BOT_RPC_SECRET","") if str(admin_id)==old.get("ADMIN_TELEGRAM_ID") else ""
    if secret and input("الربط السابق موجود. إعادة إنشاء مفتاح الخادم؟ (ن/لا): ").strip()!="ن":
        print("✅ الاحتفاظ بمفتاح الربط السابق.")
    else:
        secret=secrets.token_hex(32)
        print("\nلإنشاء الربط الآمن لأول مرة، يلزم مفتاح service_role مؤقتًا.")
        print("لن يُحفظ المفتاح في ملفات البوت. تقدر تحصل عليه من إعدادات Supabase → API Keys.")
        service=getpass.getpass("Supabase service_role secret (لن يظهر): ").strip()
        if not service:raise SystemExit("مفتاح الإدارة مطلوب لإنشاء الربط أول مرة.")
        headers={"apikey":service}
        if not service.startswith("sb_secret_"):headers["Authorization"]="Bearer "+service
        provision=api(url.rstrip("/")+"/rest/v1/rpc/debt_telegram_admin_provision",
            {"p_secret":secret,"p_telegram_id":admin_id},headers)
        if not provision.get("ok"):
            raise SystemExit("تعذر الربط: "+str(provision.get("error","UNKNOWN")))
        del service
        print("✅ ربط الخادم بنجاح.")
    probe=api(url.rstrip("/")+"/rest/v1/rpc/debt_telegram_admin_dispatch",
              {"p_secret":secret,"p_telegram_id":admin_id,"p_action":"ping","p_args":{}},
              {"apikey":pub,**({} if pub.startswith("sb_publishable_") else {"Authorization":"Bearer "+pub})})
    if not probe.get("ok"):
        raise SystemExit("فشل اختبار صلاحيات الربط؛ لم تُحفظ أي أسرار جديدة.")
    final={"BOT_TOKEN":token,"ADMIN_TELEGRAM_ID":str(admin_id),"SUPABASE_URL":url,
           "SUPABASE_PUBLISHABLE_KEY":pub,"BOT_RPC_SECRET":secret}
    temp=ENV.with_suffix(".env.tmp")
    temp.write_text("# UCHIHA bot private environment; never commit or share\n"
                    +"\n".join(k+"="+str(v) for k,v in final.items())+"\n",encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(ENV)
    ENV.chmod(0o600)
    print("\n✅ اكتمل الإعداد. شغل البوت بالأمر: python3 bot.py")
    print("افتح @"+str(username)+" وأرسل /start لتظهر الأزرار.")


if __name__=="__main__":
    try:main()
    except (RuntimeError,EOFError,KeyboardInterrupt) as exc:
        print("\nلم يكتمل الإعداد: "+str(exc))
        sys.exit(1)
