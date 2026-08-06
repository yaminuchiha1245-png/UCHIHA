"""Professional owner-panel parity layer for the UCHIHA demo store."""
from __future__ import annotations


ADMIN_PARITY_CSS = r"""
    /* Admin parity v1 — compact, serious, consistent merchant control panel. */
    :root{
      --bg:#0f1115;--panel:#181c22;--panel2:#1e232b;--panel3:#252b34;
      --text:#f5f7fa;--muted:#a4acb8;--line:rgba(255,255,255,.085);
      --primary:#c62835;--secondary:#8c1d27;--danger:#d9414d;--gold:#d8942f;
      --shadow:0 18px 50px rgba(0,0,0,.36);--control-h:44px;--radius:12px
    }
    html{background:var(--bg)}
    body{
      background:linear-gradient(180deg,#101217,#0d0f13);
      color:var(--text);font-family:"IBM Plex Sans Arabic",Tahoma,"Segoe UI",Arial,sans-serif
    }
    .layout{grid-template-columns:244px minmax(0,1fr)}
    .sidebar{
      border-left:1px solid var(--line);background:rgba(15,17,21,.97);
      backdrop-filter:blur(18px)
    }
    .side-brand{height:72px;padding:0 16px;border-bottom:1px solid var(--line);gap:11px}
    .side-brand img{width:42px;height:42px;border-radius:10px;border:1px solid rgba(198,40,53,.25)}
    .side-brand b{font-size:14px}.side-brand small{font-size:8px;color:var(--muted)}
    .nav{padding:12px 9px}
    .nav-btn{
      height:44px;margin-bottom:4px;padding:0 12px;border-radius:9px;
      color:#b8c0cb;font-size:11px;font-weight:700;gap:10px;
      transition:background .16s ease,color .16s ease,transform .16s ease
    }
    .nav-btn:hover{background:var(--panel);color:#fff}
    .nav-btn.active{background:rgba(198,40,53,.12);color:#fff;box-shadow:inset -3px 0 0 var(--primary)}
    .nav-btn .admin-nav-icon{width:18px;height:18px;display:grid;place-items:center;color:var(--muted)}
    .nav-btn.active .admin-nav-icon{color:var(--primary)}
    .nav-btn .admin-nav-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .side-foot{padding:12px;border-top:1px solid var(--line)}

    .top{
      height:66px;padding:0 20px;border-bottom:1px solid var(--line);
      background:rgba(15,17,21,.93);backdrop-filter:blur(18px)
    }
    .top h1{font-size:16px;font-weight:900}
    .top-actions{gap:8px}
    .content{width:min(1320px,calc(100% - 32px));margin:20px auto 46px}
    .view{animation:adminParityIn .2s ease both}
    @keyframes adminParityIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

    .cards{grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
    .stat{
      min-height:110px;padding:15px;border:1px solid var(--line);border-radius:12px;
      background:var(--panel);box-shadow:none
    }
    .stat:after{display:none}.stat i{width:6px;height:6px;margin-bottom:10px;box-shadow:none}
    .stat span{font-size:9px}.stat strong{margin-top:12px;font-size:21px}

    .section{
      margin-top:14px;padding:18px;border:1px solid var(--line);
      border-radius:14px;background:var(--panel);box-shadow:none
    }
    .section-head{margin-bottom:15px}.section-head h2{font-size:16px}.section-head p{font-size:9px}
    .actions{gap:8px}
    .primary,.secondary,.danger,.ghost{
      height:var(--control-h);min-height:var(--control-h);padding:0 15px;
      border-radius:10px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;gap:7px
    }
    .primary{border:1px solid var(--primary);background:var(--primary);box-shadow:none}
    .secondary{border:1px solid rgba(198,40,53,.28);background:rgba(198,40,53,.09);color:#f2c4c8}
    .danger{border:1px solid rgba(217,65,77,.3);background:rgba(217,65,77,.09);color:#ffb0b7}
    .ghost{border:1px solid var(--line);background:var(--panel2)}
    .small{height:36px;min-height:36px;padding:0 10px;font-size:9px;border-radius:8px}
    button:active{transform:scale(.985)}

    .grid2,.grid3{gap:11px}
    .field{margin-bottom:11px}.field label{margin-bottom:7px;font-size:9px;color:#dce1e8}
    .input,.select,.textarea{
      min-height:var(--control-h);padding:0 12px;border:1px solid var(--line);
      border-radius:10px;background:#12151a;color:var(--text)
    }
    .textarea{min-height:96px;padding-top:11px}
    .input:focus,.select:focus,.textarea:focus{border-color:rgba(198,40,53,.5);box-shadow:0 0 0 3px rgba(198,40,53,.08)}
    .check{font-size:9px}.check input{width:17px;height:17px}

    .table-wrap{border:1px solid var(--line);border-radius:11px;background:var(--panel2)}
    .table th,.table td{padding:11px 12px;border-bottom:1px solid var(--line);font-size:9px}
    .table th{background:#20252d;color:#b1b9c4;font-size:8px}
    .table tr:hover td{background:rgba(255,255,255,.018)}
    .badge{padding:5px 8px;border-radius:7px;font-size:8px}
    .badge.ok{background:rgba(47,173,104,.13);color:#79daa6}
    .badge.wait{background:rgba(216,148,47,.13);color:#efb96b}
    .badge.bad{background:rgba(217,65,77,.13);color:#f18a93}

    .banner-list,.category-list,.method-list{gap:10px}
    .banner-item{
      grid-template-columns:190px 1fr auto;gap:14px;padding:12px;
      border:1px solid var(--line);border-radius:11px;background:var(--panel2)
    }
    .banner-item img{width:190px;border-radius:9px}.banner-item h3{font-size:12px}.banner-item p{font-size:8px}
    .editor{padding:15px;border:1px solid var(--line);border-radius:11px;background:var(--panel2)}
    .editor h3{font-size:13px}.image-preview{border-radius:10px}
    .category-row,.method-row{
      border:1px solid var(--line);border-radius:11px;background:var(--panel2);gap:10px
    }
    .category-row img{border-radius:9px}.method-icon{border-radius:9px;background:rgba(198,40,53,.09);color:#f2c4c8}
    .filter{gap:8px}

    .modal-overlay{background:rgba(5,6,8,.72);backdrop-filter:blur(4px)}
    .modal{padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)}
    .modal-head{margin-bottom:15px}.modal-head h2{font-size:16px}.close{width:38px;height:38px;border-radius:9px;background:var(--panel2)}

    .login-screen{
      place-items:center start;padding:clamp(18px,6vw,80px);
      background:
        linear-gradient(90deg,rgba(9,11,14,.12),rgba(9,11,14,.68) 54%,rgba(9,11,14,.96)),
        url("/assets/hero-madara-v2.webp") center/cover no-repeat
    }
    .login-card{
      width:min(430px,100%);padding:26px;border:1px solid var(--line);
      border-radius:14px;background:rgba(24,28,34,.96);box-shadow:var(--shadow);backdrop-filter:blur(16px)
    }
    .login-brand{margin-bottom:20px}.login-brand img{width:62px}.login-brand h1{font-size:20px}.login-brand p{font-size:9px}
    .login-error{border-radius:9px;font-size:9px}
    .toast{border-radius:10px;background:var(--panel2);font-size:9px}
    .empty{border-radius:11px;font-size:9px}.loading{font-size:9px}
    .mobile-menu{width:40px;height:40px;border-radius:9px;background:var(--panel2)}

    .admin-loading-spinner{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,.14);border-top-color:var(--primary);border-radius:50%;animation:adminSpin .8s linear infinite;vertical-align:middle;margin-inline-end:7px}
    @keyframes adminSpin{to{transform:rotate(360deg)}}

    @media(max-width:1120px){.cards{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:820px){
      .sidebar{width:min(280px,88vw)}.top{padding:0 12px}.content{width:calc(100% - 20px);margin-top:12px}
      .banner-item{grid-template-columns:120px 1fr}.banner-item img{width:120px}
      .login-screen{place-items:center;padding:15px;background:linear-gradient(rgba(9,11,14,.72),rgba(9,11,14,.93)),url("/assets/hero-madara-v2.webp") 58% center/cover no-repeat}
    }
    @media(max-width:520px){
      .cards{grid-template-columns:repeat(2,1fr)}.stat{min-height:98px}.stat strong{font-size:18px}
      .section{padding:13px}.top h1{font-size:14px}
    }
    @media(prefers-reduced-motion:reduce){.view{animation:none}.admin-loading-spinner{animation-duration:2s}}
"""


ADMIN_PARITY_JS = r'''
  (function installAdminParityV1(){
    if(document.documentElement.dataset.adminParityV1==='1')return;
    document.documentElement.dataset.adminParityV1='1';
    const icons={
      dashboard:'<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
      appearance:'<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h1.3a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12h-3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="9" cy="6.5" r="1"/><circle cx="14" cy="6" r="1"/></svg>',
      categories:'<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
      payments:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h3"/></svg>',
      deposits:'<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>',
      orders:'<svg viewBox="0 0 24 24"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/></svg>',
      customers:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7"/><path d="M16 6a3 3 0 0 1 0 6M17 14c2.5.7 4 2.8 4 6"/></svg>'
    };
    const labels={dashboard:'لوحة التحكم',appearance:'الهوية والصور',categories:'الأقسام',payments:'طرق الدفع',deposits:'طلبات الشحن',orders:'الطلبات',customers:'العملاء والأرصدة'};
    document.querySelectorAll('.nav-btn[data-view]').forEach(button=>{
      const key=button.dataset.view;
      button.innerHTML=`<span class="admin-nav-icon" aria-hidden="true">${icons[key]||''}</span><span>${labels[key]||button.textContent.trim()}</span>`;
    });
    document.querySelectorAll('.loading').forEach(node=>{
      if(!node.querySelector('.admin-loading-spinner'))node.insertAdjacentHTML('afterbegin','<span class="admin-loading-spinner" aria-hidden="true"></span>');
    });
    const observer=new MutationObserver(records=>{
      records.forEach(record=>record.addedNodes.forEach(node=>{
        if(node.nodeType!==1)return;
        if(node.matches?.('.loading')&&!node.querySelector('.admin-loading-spinner'))node.insertAdjacentHTML('afterbegin','<span class="admin-loading-spinner" aria-hidden="true"></span>');
        node.querySelectorAll?.('.loading').forEach(item=>{if(!item.querySelector('.admin-loading-spinner'))item.insertAdjacentHTML('afterbegin','<span class="admin-loading-spinner" aria-hidden="true"></span>')});
      }));
    });
    observer.observe(document.body,{childList:true,subtree:true});
  })();
'''


def _inject_before_once(document: str, marker: str, content: str, name: str) -> str:
    if marker not in document:
        raise RuntimeError(f"{name} marker was not found")
    return document.replace(marker, content + marker, 1)


def patch_admin_html(document: str) -> str:
    if "adminParityV1" in document:
        return document
    document = _inject_before_once(document, "  </style>", ADMIN_PARITY_CSS + "\n", "Admin style")
    document = _inject_before_once(document, "</body>", f"<script>{ADMIN_PARITY_JS}</script>\n", "Admin body")
    return document


__all__ = ["patch_admin_html"]
