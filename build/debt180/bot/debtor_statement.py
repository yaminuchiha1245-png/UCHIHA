"""Safe, temporary export of a shop debtor from a USER-SUPPLIED app JSON backup.

No Supabase encrypted backups are decrypted here, and no app secrets are stored.
This PDF is a readable reference; the existing full app backup is the
machine-restorable source of truth for automatic full-shop recovery.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from user_report_pdf import register_font, rtl, safe_text

LIMIT_BYTES = 6_000_000
MAX_CLIENTS = 2500
MAX_ENTRIES = 16000
CLIENT_KEYS = {
    "id","name","phone","area","notes","address","maxDays","debtLimit",
    "createdAt","createdBy","whatsappNumber","whatsappOptIn","pinned","remoteId",
}
ENTRY_KEYS = {
    "id","date","type","paidUsd","clientId","createdAt","createdBy","settledAt",
    "sypAmount","tryAmount","usdAmount","rateUsdSyp","rateUsdTry",
    "allocations","description","remainingUsd","originalAmount",
    "originalCurrency",
}
DARK = colors.HexColor("#081928")
PANEL = colors.HexColor("#10273B")
PANEL2 = colors.HexColor("#162F45")
LINE = colors.HexColor("#31516B")
WHITE = colors.HexColor("#EFF5FA")
DIM = colors.HexColor("#A4B4C2")
BLUE = colors.HexColor("#4BB8F8")
GREEN = colors.HexColor("#00C992")


class InvalidShopBackup(ValueError):
    pass


def dec(value: Any) -> Decimal:
    try:
        v = Decimal(str(value if value not in (None,"") else "0"))
        return v if v.is_finite() else Decimal("0")
    except (ValueError, InvalidOperation, TypeError):
        return Decimal("0")


def money(value: Any) -> str:
    return format(dec(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), ",.2f")


def sanitize_string(value: Any, limit: int = 160) -> str:
    if value is None:
        return ""
    if not isinstance(value, (str,int,float,bool)):
        return ""
    return str(value).strip()[:limit]


def parse_backup(raw: bytes) -> dict[str, Any]:
    if not isinstance(raw,bytes) or not 1<=len(raw)<=LIMIT_BYTES:
        raise InvalidShopBackup("حجم نسخة البيانات غير مدعوم (الحد 6 ميغابايت).")
    try:
        document=json.loads(raw.decode("utf-8-sig"),
                            parse_constant=lambda _x: (_ for _ in ()).throw(ValueError("Invalid numeric constant")))
    except (UnicodeDecodeError,json.JSONDecodeError,ValueError) as exc:
        raise InvalidShopBackup("الملف ليس نسخة JSON صالحة من تطبيق الديون.") from None
    if isinstance(document,dict) and "snapshot" in document:
        document=document["snapshot"]
    if not isinstance(document,dict) or document.get("setupDone") is not True:
        raise InvalidShopBackup("النسخة لا تحتوي على بيانات تطبيق الديون المكتملة.")
    clients=document.get("clients")
    entries=document.get("entries")
    if not isinstance(clients,list) or not isinstance(entries,list):
        raise InvalidShopBackup("ملف النسخة لا يحتوي على الزبائن والتسجيلات.")
    if len(clients)>MAX_CLIENTS or len(entries)>MAX_ENTRIES:
        raise InvalidShopBackup("حجم دفتر الزبائن كبير جدًا لهذا التصدير.")
    shop=document.get("shop")
    if not isinstance(shop,dict):
        raise InvalidShopBackup("بيانات المحل غير موجودة.")
    rates=document.get("rates")
    if not isinstance(rates,dict):
        rates={}
    result_clients=[]
    client_ids=set()
    for item in clients:
        if not isinstance(item,dict):
            raise InvalidShopBackup("بيانات أحد الزبائن غير صحيحة.")
        cid=sanitize_string(item.get("id"),128)
        if not cid or cid in client_ids:
            raise InvalidShopBackup("توجد هوية زبون مفقودة أو مكررة بالنسخة.")
        client_ids.add(cid)
        result_clients.append({k:item[k] for k in CLIENT_KEYS if k in item})
    result_entries=[]
    entry_ids=set()
    for item in entries:
        if not isinstance(item,dict):
            raise InvalidShopBackup("يوجد تسجيل غير صالح داخل النسخة.")
        eid=sanitize_string(item.get("id"),128)
        if not eid or eid in entry_ids:
            raise InvalidShopBackup("توجد هوية تسجيل مفقودة أو مكررة بالنسخة.")
        entry_ids.add(eid)
        cid=sanitize_string(item.get("clientId"),128)
        if cid in client_ids:
            result_entries.append({k:item[k] for k in ENTRY_KEYS if k in item})
    # Explicitly discard accounts, account PIN hashes, activation tokens,
    # device sessions, unrelated cloud config, products, and secret settings.
    return {
        "shop":{"name":sanitize_string(shop.get("name"),100) or "دفتر الديون",
                "phone":sanitize_string(shop.get("phone"),30),
                "pdfFooter":sanitize_string(shop.get("pdfFooter"),100)},
        "clients":result_clients, "entries":result_entries,
        "rates":{"usdTry":str(dec(rates.get("usdTry"))),
                 "usdSyp":str(dec(rates.get("usdSyp")))},
        "uploaded_at":datetime.now(timezone.utc).isoformat(),
        "source_sha256":hashlib.sha256(raw).hexdigest(),
    }


def one_client(snapshot: dict[str,Any],client_id: str) -> tuple[dict,list[dict]]:
    found=next((x for x in snapshot["clients"] if str(x.get("id"))==client_id),None)
    if found is None:
        raise InvalidShopBackup("الزبون غير موجود ضمن هذه النسخة.")
    rows=[x for x in snapshot["entries"] if str(x.get("clientId"))==client_id]
    rows.sort(key=lambda x:(str(x.get("createdAt") or x.get("date") or ""),str(x.get("id") or "")))
    return found,rows


def statement(snapshot: dict[str,Any],client_id: str) -> dict[str,Any]:
    client,rows=one_client(snapshot,client_id)
    running=Decimal("0")
    buys=Decimal("0")
    pays=Decimal("0")
    due=Decimal("0")
    normalized=[]
    for entry in rows:
        kind=entry.get("type")
        amount=dec(entry.get("usdAmount"))
        if kind in ("purchase","opening"):
            buys+=amount
            due+=dec(entry.get("remainingUsd"))
            running+=amount
        elif kind=="payment":
            pays+=amount
            running=max(Decimal("0"),running-amount)
        cur=str(entry.get("originalCurrency") or "USD").upper()
        if cur not in ("USD","TRY","SYP"):
            cur="USD"
        original=dec(entry.get("originalAmount"))
        rate=(dec(entry.get("rateUsdTry") or snapshot["rates"]["usdTry"])
              if cur=="TRY" else
              dec(entry.get("rateUsdSyp") or snapshot["rates"]["usdSyp"])
              if cur=="SYP" else Decimal("1"))
        balance_cur=running*rate if rate>0 else running
        normalized.append({
            "id":entry.get("id"),"date":sanitize_string(entry.get("date") or entry.get("createdAt"),24)[:10],
            "type":"دفعة" if kind=="payment" else "رصيد افتتاحي" if kind=="opening" else "شراء" if kind=="purchase" else "أخرى",
            "original":original,"currency":cur,"usd":amount,
            "balance_usd":running,"balance_currency":balance_cur,
            "description":sanitize_string(entry.get("description"),120),
        })
    return {
        "shop":snapshot["shop"],"client":client,
        "uploaded_at":snapshot["uploaded_at"],"source_sha256":snapshot["source_sha256"],
        "buy_usd":buys,"paid_usd":pays,"due_usd":due,
        "operations":len(rows),"entries":normalized,
    }


def recovery_json(snapshot: dict[str,Any],client_id: str) -> bytes:
    client,rows=one_client(snapshot,client_id)
    # Original client and entry IDs are essential for manual reconciliation.
    # This format is NEVER an automatically restorable full-shop snapshot.
    result={
        "format":"uchiha-single-debtor-recovery-v1",
        "notice":"Individual support export. Do not import over an entire existing shop backup.",
        "shop":snapshot["shop"],
        "client":client,"entries":rows,"rates":snapshot["rates"],
        "source_sha256":snapshot["source_sha256"],
        "uploaded_at":snapshot["uploaded_at"],
        "record_count":len(rows),
    }
    blob=json.dumps(result,ensure_ascii=False,separators=(",",":"),default=str).encode("utf-8")
    if len(blob)>LIMIT_BYTES:
        raise InvalidShopBackup("سجلات هذا الزبون أكبر من حجم الملف المسموح.")
    return blob


def render_pdf(snapshot: dict[str,Any],client_id: str,full: bool=False) -> bytes:
    data=statement(snapshot,client_id)
    register_font()
    rows=data["entries"]
    selected=rows if full else rows[-10:]
    if len(selected)>1000:
        raise InvalidShopBackup("الكشف الكامل أكبر من الحد المسموح؛ استخدم نسخة الاستعادة JSON.")
    result=io.BytesIO()
    c=canvas.Canvas(result,pagesize=A4,pageCompression=1)
    c.setTitle("UCHIHA - Debtor Statement")
    c.setAuthor("UCHIHA")
    W,H=A4
    left,right=34,W-34
    table_cols=[right,right-78,right-156,right-266,right-337,right-428]
    def txt(value,x,y,size=10,color=WHITE,max_width=500):
        c.setFont("DebtArabic",size);c.setFillColor(color)
        raw=safe_text(value,160)
        while raw:
            display=raw if raw.isascii() else rtl(raw)
            if c.stringWidth(display,"DebtArabic",size)<=max_width:
                c.drawRightString(x,y,display);return
            raw=raw[:-2]+"…" if len(raw)>3 else raw[:-1]
    def section(y,height,color=PANEL):
        c.setFillColor(color);c.roundRect(left,y,right-left,height,9,fill=1,stroke=0)
    def page(page_no:int,first:bool):
        c.setFillColor(DARK);c.rect(0,0,W,H,stroke=0,fill=1)
        c.setFillColor(BLUE);c.rect(0,H-84,6,84,stroke=0,fill=1)
        txt(data["shop"].get("name"),right,H-33,16,WHITE,320)
        txt("كشف حساب زبون - تطبيق الديون",right,H-61,10,DIM,320)
        txt("UCHIHA",left+85,H-37,12,BLUE,100)
        if first:
            section(H-192,98)
            txt(data["client"].get("name") or "زبون",right-12,H-110,15,WHITE,455)
            txt("الهاتف: "+str(data["client"].get("phone") or "—"),
                right-12,H-135,10,DIM,450)
            txt("العنوان: "+str(data["client"].get("address") or data["client"].get("area") or "—"),
                right-12,H-157,9.3,DIM,450)
            section(H-277,72)
            # Three numbers side by side: purchases, payments and outstanding.
            for x,label,value,col in (
                (right-12,"الرصيد المتبقي",data["due_usd"],BLUE),
                (right-183,"إجمالي الدفعات",data["paid_usd"],GREEN),
                (right-345,"إجمالي الشراء",data["buy_usd"],WHITE),
            ):
                txt(label,x,H-232,9.2,DIM,155)
                txt("$"+money(value),x,H-258,13,col,155)
            top=H-302
        else:
            section(H-112,28)
            txt("تكملة كشف حساب "+str(data["client"].get("name") or ""),right-8,H-103,9.7,WHITE,390)
            top=H-134
        c.setFillColor(PANEL2);c.roundRect(left,top-28,right-left,29,4,fill=1,stroke=0)
        for x,label,w in zip(table_cols[:5],
                             ("التاريخ","العملية","المبلغ","العملة","الرصيد"),
                             (75,70,100,65,110)):
            txt(label,x-8,top-19,9.1,DIM,w)
        return top-32

    max_first=11 if full else 10
    if not full:
        max_first=10
    subsequent=17
    page_no=1
    index=0
    while True:
        first=page_no==1
        y=page(page_no,first)
        capacity=max_first if first else subsequent
        subset=selected[index:index+capacity]
        if not subset and first:
            txt("لا توجد تسجيلات في النسخة المختارة.",right-10,y-24,10,DIM,400)
        for i,e in enumerate(subset):
            if i%2==0:
                c.setFillColor(PANEL);c.rect(left,y-29,right-left,34,fill=1,stroke=0)
            original=money(e["original"])
            col=e["currency"]
            fields=(
                str(e.get("date") or "—"),
                e["type"],
                original,
                col,
                money(e["balance_currency"]),
            )
            for x,value,width in zip(table_cols[:5],fields,(76,75,120,60,115)):
                txt(value,x-8,y-12,9 if col!="SYP" else 8.4,
                    GREEN if e["type"]=="دفعة" else WHITE,width)
            y-=35
        c.setStrokeColor(LINE);c.line(left,58,right,58)
        txt("حسب النسخة المرفوعة فقط | بصمة الملف "+data["source_sha256"][:12],
            right,43,8.2,DIM,500)
        if not full and data["operations"]>10:
            txt("آخر 10 من أصل "+str(data["operations"])+" تسجيلات",right,72,8.5,BLUE,225)
        txt("صفحة "+str(page_no),left+70,43,8,DIM,70)
        c.showPage()
        index+=len(subset)
        if index>=len(selected) or (not subset):
            break
        page_no+=1
        if page_no>65:
            raise InvalidShopBackup("الملف يتجاوز عدد الصفحات المدعوم.")
    c.save()
    blob=result.getvalue()
    if not blob.startswith(b"%PDF-") or len(blob)>6_000_000:
        raise InvalidShopBackup("تعذر تجهيز كشف PDF بحجم مدعوم.")
    return blob
