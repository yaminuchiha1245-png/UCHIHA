"""Responsive Arabic storefront theme for UCHIHA STORE.

The theme is intentionally self-contained so Railway can serve it without a
frontend build step or third-party assets.
"""

STOREFRONT_HTML = r"""<!doctype html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#08090d">
  <meta name="color-scheme" content="dark light">
  <meta name="description" content="UCHIHA STORE للمنتجات والخدمات الرقمية والتسليم السريع">
  <meta property="og:type" content="website">
  <meta property="og:title" content="UCHIHA STORE">
  <meta property="og:description" content="منتجات رقمية موثوقة وتسليم سريع عبر تيليجرام">
  <title>UCHIHA STORE</title>
  <style>
    :root{
      --bg:#07080b;--bg-soft:#0d0f15;--panel:#11141b;--panel-2:#171a23;
      --text:#f7f8fb;--muted:#9da5b4;--line:rgba(255,255,255,.09);
      --brand:#ef334b;--brand-2:#8f0e20;--brand-soft:rgba(239,51,75,.13);
      --success:#42d392;--warning:#ffbd59;--shadow:0 24px 70px rgba(0,0,0,.38);
      --radius:22px;--header:76px;--max:1240px
    }
    html[data-theme="light"]{
      --bg:#f4f5f8;--bg-soft:#eceef3;--panel:#fff;--panel-2:#f8f9fb;
      --text:#171922;--muted:#667085;--line:rgba(18,24,40,.10);
      --brand-soft:rgba(239,51,75,.09);--shadow:0 22px 65px rgba(18,24,40,.10)
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{
      margin:0;min-height:100vh;background:
        radial-gradient(circle at 88% -5%,rgba(239,51,75,.20),transparent 31%),
        radial-gradient(circle at -8% 35%,rgba(117,73,255,.08),transparent 26%),
        var(--bg);color:var(--text);font-family:Tahoma,Arial,sans-serif
    }
    body.locked{overflow:hidden}
    button,input,select{font:inherit}
    button,a,select{-webkit-tap-highlight-color:transparent}
    button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{
      outline:3px solid rgba(239,51,75,.30);outline-offset:2px
    }
    a{color:inherit;text-decoration:none}
    .shell{width:min(var(--max),calc(100% - 28px));margin:auto}
    .skip{position:fixed;z-index:200;top:-70px;right:18px;background:var(--brand);color:#fff;padding:12px 16px;border-radius:12px}
    .skip:focus{top:14px}
    .announcement{border-bottom:1px solid var(--line);background:#0a0b0f;color:#d9dde6}
    html[data-theme="light"] .announcement{background:#1a1c24;color:#fff}
    .announcement .shell{min-height:36px;display:flex;align-items:center;justify-content:center;gap:9px;font-size:12px;text-align:center}
    .live-dot{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 0 5px rgba(66,211,146,.10)}
    .header{position:sticky;top:0;z-index:40;border-bottom:1px solid var(--line);background:rgba(7,8,11,.82);backdrop-filter:blur(18px)}
    html[data-theme="light"] .header{background:rgba(255,255,255,.86)}
    .nav{min-height:var(--header);display:flex;align-items:center;gap:24px}
    .brand{display:flex;align-items:center;gap:11px;white-space:nowrap}
    .mark{position:relative;width:46px;height:46px;display:grid;place-items:center;border-radius:15px;background:linear-gradient(145deg,var(--brand),#550711);box-shadow:0 12px 30px rgba(239,51,75,.27);color:#fff;font-weight:900}
    .mark:before{content:"";position:absolute;inset:8px;border:1px solid rgba(255,255,255,.36);border-radius:50%;transform:rotate(35deg)}
    .mark span{position:relative}
    .brand strong{display:block;font-size:15px;letter-spacing:.5px}
    .brand small{display:block;margin-top:3px;color:var(--muted);font-size:9px;letter-spacing:1.6px}
    .links{display:flex;align-items:center;gap:20px;margin-inline-start:auto;color:var(--muted);font-size:13px;font-weight:700}
    .links a:hover{color:var(--text)}
    .actions{display:flex;align-items:center;gap:8px}
    .control,.ghost,.primary,.secondary{
      min-height:44px;border-radius:13px;cursor:pointer;font-weight:800;transition:.2s
    }
    .control,.ghost{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:0 13px}
    .control:hover,.ghost:hover{border-color:rgba(239,51,75,.35);transform:translateY(-1px)}
    .currency{max-width:92px}
    .cart-button{position:relative}
    .cart-count{position:absolute;top:-8px;left:-7px;min-width:21px;height:21px;display:grid;place-items:center;border:2px solid var(--bg);border-radius:20px;background:var(--brand);color:#fff;font-size:10px}
    .primary,.secondary{min-height:49px;padding:0 20px}
    .primary{border:0;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:#fff;box-shadow:0 13px 30px rgba(239,51,75,.22)}
    .primary:hover{transform:translateY(-2px);box-shadow:0 17px 38px rgba(239,51,75,.28)}
    .secondary{border:1px solid var(--line);background:rgba(255,255,255,.055);color:var(--text)}
    html[data-theme="light"] .secondary{background:#fff}
    .hero{padding:48px 0 22px}
    .hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(330px,.85fr);gap:20px}
    .hero-copy,.hero-visual{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:30px;box-shadow:var(--shadow)}
    .hero-copy{min-height:410px;padding:46px;background:linear-gradient(125deg,rgba(239,51,75,.23),rgba(17,20,27,.96) 50%,rgba(12,14,20,.98))}
    html[data-theme="light"] .hero-copy{background:linear-gradient(125deg,rgba(239,51,75,.13),#fff 54%,#f8f9fc)}
    .hero-copy:after{content:"UCHIHA";position:absolute;left:-14px;bottom:-43px;color:rgba(255,255,255,.035);font-size:126px;font-weight:900;letter-spacing:10px}
    html[data-theme="light"] .hero-copy:after{color:rgba(25,28,38,.035)}
    .eyebrow{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid rgba(239,51,75,.27);border-radius:99px;background:var(--brand-soft);color:#ffb9c2;font-size:12px;font-weight:900}
    html[data-theme="light"] .eyebrow{color:#a11629}
    h1{position:relative;z-index:1;max-width:720px;margin:18px 0 15px;font-size:clamp(38px,5.7vw,68px);line-height:1.04;letter-spacing:-1.6px}
    .accent{color:var(--brand)}
    .hero-copy p{position:relative;z-index:1;max-width:690px;margin:0;color:#c9ced8;font-size:16px;line-height:1.95}
    html[data-theme="light"] .hero-copy p{color:#566074}
    .hero-actions{position:relative;z-index:1;display:flex;gap:10px;flex-wrap:wrap;margin-top:25px}
    .hero-visual{min-height:410px;padding:23px;background:linear-gradient(160deg,var(--panel-2),var(--bg-soft))}
    .visual-head{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px}
    .status{display:flex;align-items:center;gap:8px;color:var(--success);font-weight:800}
    .orbit{position:relative;height:193px;display:grid;place-items:center;margin:14px 0}
    .orbit:before,.orbit:after{content:"";position:absolute;border:1px solid rgba(239,51,75,.24);border-radius:50%}
    .orbit:before{width:220px;height:128px;transform:rotate(-20deg)}
    .orbit:after{width:178px;height:178px;transform:rotate(28deg)}
    .core{position:relative;z-index:2;width:94px;height:94px;display:grid;place-items:center;border-radius:30px;background:linear-gradient(145deg,var(--brand),#4e0710);box-shadow:0 0 70px rgba(239,51,75,.35);color:#fff;font-size:32px;font-weight:900}
    .floating{position:absolute;z-index:3;padding:8px 11px;border:1px solid var(--line);border-radius:12px;background:rgba(17,20,27,.88);box-shadow:0 12px 30px rgba(0,0,0,.25);font-size:11px}
    html[data-theme="light"] .floating{background:rgba(255,255,255,.9)}
    .f1{right:5%;top:12%}.f2{left:2%;top:47%}.f3{right:13%;bottom:5%}
    .dashboard{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
    .metric{padding:13px;border:1px solid var(--line);border-radius:15px;background:rgba(255,255,255,.035)}
    html[data-theme="light"] .metric{background:#fff}
    .metric b{display:block;margin-bottom:4px;font-size:17px}.metric small{color:var(--muted);font-size:10px}
    .trust{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:13px}
    .trust-item{display:flex;align-items:center;gap:11px;padding:15px;border:1px solid var(--line);border-radius:17px;background:var(--panel)}
    .trust-icon{width:39px;height:39px;display:grid;place-items:center;border-radius:12px;background:var(--brand-soft);font-size:19px}
    .trust-item b{display:block;font-size:12px}.trust-item small{display:block;margin-top:4px;color:var(--muted);font-size:10px}
    .section{padding:42px 0}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:17px}
    .section-head h2{margin:0 0 7px;font-size:clamp(24px,4vw,34px)}
    .section-head p{margin:0;color:var(--muted);font-size:13px}
    .text-button{border:0;background:none;color:var(--brand);cursor:pointer;font-weight:900}
    .category-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
    .category-card{
      position:relative;min-height:132px;padding:16px;border:1px solid var(--line);border-radius:20px;
      overflow:hidden;background:linear-gradient(145deg,var(--panel-2),var(--panel));color:var(--text);
      text-align:right;cursor:pointer;transition:.22s
    }
    .category-card:after{content:"";position:absolute;width:95px;height:95px;left:-25px;bottom:-30px;border-radius:50%;background:var(--glow,rgba(239,51,75,.18));filter:blur(4px)}
    .category-card:hover,.category-card.active{transform:translateY(-4px);border-color:rgba(239,51,75,.42);box-shadow:0 15px 38px rgba(0,0,0,.18)}
    .category-card.active{background:linear-gradient(145deg,var(--brand-soft),var(--panel))}
    .category-icon{width:46px;height:46px;display:grid;place-items:center;margin-bottom:14px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(255,255,255,.07);font-size:23px}
    .category-card b{position:relative;z-index:1;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
    .category-card small{position:relative;z-index:1;display:block;margin-top:5px;color:var(--muted);font-size:10px}
    .catalog-panel{border:1px solid var(--line);border-radius:26px;background:rgba(17,20,27,.56);box-shadow:var(--shadow);overflow:hidden}
    html[data-theme="light"] .catalog-panel{background:rgba(255,255,255,.72)}
    .catalog-toolbar{display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:15px;border-bottom:1px solid var(--line)}
    .search{position:relative}
    .search input{width:100%;height:48px;padding:0 46px 0 15px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);outline:0}
    .search input:focus{border-color:rgba(239,51,75,.55);box-shadow:0 0 0 4px var(--brand-soft)}
    .search span{position:absolute;right:16px;top:14px;color:var(--muted)}
    .sort{min-height:48px;min-width:145px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);padding:0 12px}
    .result-count{min-height:48px;display:flex;align-items:center;padding:0 14px;border:1px solid var(--line);border-radius:14px;color:var(--muted);font-size:12px;white-space:nowrap}
    .product-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;padding:15px}
    .product-card{min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:20px;background:var(--panel);overflow:hidden;transition:.22s}
    .product-card:hover{transform:translateY(-4px);border-color:rgba(239,51,75,.30);box-shadow:0 17px 42px rgba(0,0,0,.18)}
    .product-visual{position:relative;height:142px;display:grid;place-items:center;overflow:hidden;background:linear-gradient(145deg,var(--tone-a,#2a1520),var(--tone-b,#141821))}
    .product-visual:before{content:"";position:absolute;width:125px;height:125px;border:1px solid rgba(255,255,255,.10);border-radius:38%;transform:rotate(35deg)}
    .product-emoji{position:relative;z-index:2;font-size:42px;filter:drop-shadow(0 10px 22px rgba(0,0,0,.30))}
    .product-tag{position:absolute;z-index:3;top:10px;right:10px;max-width:calc(100% - 20px);padding:5px 8px;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(7,8,11,.66);color:#e6e9ef;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .product-body{display:flex;flex:1;flex-direction:column;padding:14px}
    .product-body h3{min-height:44px;margin:0;font-size:14px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .product-desc{min-height:38px;margin:8px 0 12px;color:var(--muted);font-size:11px;line-height:1.7;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .availability{display:flex;align-items:center;gap:6px;color:var(--success);font-size:10px}
    .availability:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
    .price-row{display:flex;align-items:end;justify-content:space-between;gap:8px;margin-top:auto;padding-top:12px}
    .price{font-size:19px;font-weight:900}.delivery{margin-top:4px;color:var(--muted);font-size:9px}
    .card-actions{display:grid;grid-template-columns:1fr 43px;gap:7px;margin-top:12px}
    .buy,.quick,.add-cart{height:42px;border-radius:12px;cursor:pointer;font-weight:900}
    .buy{border:0;background:var(--brand);color:#fff}.quick,.add-cart{border:1px solid var(--line);background:var(--panel-2);color:var(--text)}
    .skeleton{height:340px;border-radius:20px;background:linear-gradient(90deg,var(--panel) 25%,var(--panel-2) 50%,var(--panel) 75%);background-size:200% 100%;animation:shine 1.35s infinite}
    @keyframes shine{to{background-position:-200% 0}}
    .empty{grid-column:1/-1;padding:54px 18px;text-align:center;border:1px dashed var(--line);border-radius:18px;color:var(--muted)}
    .empty strong{display:block;margin-bottom:8px;color:var(--text);font-size:16px}
    .load-more{padding:0 15px 18px;text-align:center}
    .load-more button{display:none}
    .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .step{position:relative;padding:23px;border:1px solid var(--line);border-radius:20px;background:var(--panel)}
    .step-no{width:39px;height:39px;display:grid;place-items:center;border-radius:13px;background:var(--brand-soft);color:var(--brand);font-weight:900}
    .step h3{margin:16px 0 8px;font-size:15px}.step p{margin:0;color:var(--muted);font-size:12px;line-height:1.8}
    .faq{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    details{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:0 16px}
    summary{padding:17px 0;cursor:pointer;font-weight:800;font-size:13px}
    details p{margin:0;padding:0 0 17px;color:var(--muted);font-size:12px;line-height:1.85}
    .cta{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:30px;border:1px solid rgba(239,51,75,.25);border-radius:25px;background:linear-gradient(120deg,var(--brand-soft),var(--panel));overflow:hidden}
    .cta h2{margin:0 0 8px}.cta p{margin:0;color:var(--muted);font-size:13px}
    footer{margin-top:35px;border-top:1px solid var(--line);padding:28px 0 92px;color:var(--muted);font-size:11px}
    .footer-row{display:flex;align-items:center;justify-content:space-between;gap:15px}
    .footer-links{display:flex;gap:15px}
    .overlay{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.68);opacity:0;pointer-events:none;transition:.2s}
    .overlay.show{opacity:1;pointer-events:auto}
    .drawer{position:fixed;z-index:90;top:0;bottom:0;left:0;width:min(430px,94vw);display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--bg-soft);transform:translateX(-103%);transition:.25s}
    .drawer.show{transform:none}
    .drawer-head,.drawer-foot{padding:17px;border-bottom:1px solid var(--line)}
    .drawer-head{display:flex;align-items:center;justify-content:space-between}
    .drawer-body{flex:1;overflow:auto;padding:13px}
    .drawer-foot{border-top:1px solid var(--line);border-bottom:0}
    .cart-item{display:grid;grid-template-columns:1fr auto;gap:10px;padding:13px;margin-bottom:9px;border:1px solid var(--line);border-radius:15px;background:var(--panel)}
    .cart-item b{display:block;font-size:12px;line-height:1.6}.cart-item small{display:block;margin-top:5px;color:var(--muted);font-size:10px}
    .qty{display:flex;align-items:center;gap:5px;margin-top:9px}.qty button{width:29px;height:29px;border:1px solid var(--line);border-radius:9px;background:var(--panel-2);color:var(--text);cursor:pointer}
    .remove{align-self:start;border:0;background:none;color:#ff7f90;cursor:pointer;font-size:11px}
    .total{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;font-size:18px;font-weight:900}
    .wide{width:100%}.cart-note{margin:10px 0 0;color:var(--muted);font-size:9px;line-height:1.7;text-align:center}
    .modal{position:fixed;z-index:100;inset:50% auto auto 50%;width:min(650px,calc(100% - 24px));max-height:90vh;overflow:auto;border:1px solid var(--line);border-radius:25px;background:var(--bg-soft);box-shadow:var(--shadow);opacity:0;pointer-events:none;transform:translate(-50%,-47%) scale(.97);transition:.2s}
    .modal.show{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}
    .modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}
    .modal-content{display:grid;grid-template-columns:220px 1fr;gap:20px;padding:18px}
    .modal-art{min-height:240px;display:grid;place-items:center;border-radius:20px;background:linear-gradient(145deg,#35151e,#121621);font-size:64px}
    .modal-copy h2{margin:5px 0 10px;font-size:22px;line-height:1.5}.modal-copy p{color:var(--muted);font-size:12px;line-height:1.9}
    .modal-price{margin:18px 0 4px;font-size:27px;font-weight:900}.modal-actions{display:flex;gap:8px;margin-top:18px}
    .toast{position:fixed;z-index:130;right:50%;bottom:86px;max-width:calc(100% - 24px);padding:12px 16px;border:1px solid var(--line);border-radius:13px;background:#222631;color:#fff;box-shadow:var(--shadow);opacity:0;pointer-events:none;transform:translate(50%,18px);transition:.2s;font-size:12px}
    .toast.show{opacity:1;transform:translate(50%,0)}
    .mobile-nav{display:none}
    @media(max-width:1050px){
      .links{display:none}.hero-grid{grid-template-columns:1fr}.hero-copy{min-height:350px}.hero-visual{min-height:330px}
      .category-grid{grid-template-columns:repeat(4,1fr)}.product-grid{grid-template-columns:repeat(3,1fr)}
    }
    @media(max-width:760px){
      :root{--header:66px}.shell{width:min(100% - 20px,var(--max))}
      .announcement .shell{min-height:32px;font-size:10px}.nav{gap:9px}.brand{margin-left:auto}.brand small{display:none}
      .mark{width:41px;height:41px}.brand strong{font-size:13px}.theme-label,.cart-label{display:none}.control{padding:0 11px}.currency{max-width:75px}
      .hero{padding-top:18px}.hero-copy{min-height:390px;padding:27px 21px;border-radius:24px}.hero-copy:after{font-size:83px;bottom:-26px}
      h1{font-size:40px;letter-spacing:-1px}.hero-copy p{font-size:14px}.hero-visual{display:none}
      .trust{grid-template-columns:1fr 1fr}.trust-item{padding:12px}.section{padding:32px 0}
      .category-grid{grid-template-columns:repeat(2,1fr);gap:9px}.category-card{min-height:119px}
      .catalog-panel{border-radius:20px}.catalog-toolbar{grid-template-columns:1fr 110px}.result-count{grid-column:1/-1;min-height:36px;justify-content:center}
      .sort{min-width:0;width:100%}.product-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:10px}
      .product-visual{height:115px}.product-body{padding:11px}.product-body h3{font-size:12px}.product-desc{display:none}.price{font-size:16px}
      .card-actions{grid-template-columns:1fr 39px}.buy,.quick,.add-cart{height:39px;font-size:11px}
      .steps,.faq{grid-template-columns:1fr}.cta{align-items:flex-start;flex-direction:column}.footer-row{align-items:flex-start;flex-direction:column}
      .mobile-nav{position:fixed;z-index:55;right:10px;left:10px;bottom:9px;display:grid;grid-template-columns:repeat(4,1fr);padding:7px;border:1px solid var(--line);border-radius:18px;background:rgba(15,17,23,.92);backdrop-filter:blur(18px);box-shadow:0 15px 40px rgba(0,0,0,.3)}
      html[data-theme="light"] .mobile-nav{background:rgba(255,255,255,.92)}
      .mobile-nav a,.mobile-nav button{display:grid;place-items:center;gap:2px;min-height:47px;border:0;background:none;color:var(--muted);font-size:9px;cursor:pointer}
      .mobile-nav span{font-size:18px}.modal-content{grid-template-columns:1fr}.modal-art{min-height:150px}
    }
    @media(max-width:390px){.product-grid{grid-template-columns:1fr}.product-visual{height:138px}.actions .theme-button{display:none}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <a class="skip" href="#products">انتقل إلى المنتجات</a>
  <div class="announcement"><div class="shell"><span class="live-dot"></span><span id="announcementText">منتجات رقمية أصلية وتسليم سريع عبر تيليجرام</span></div></div>
  <header class="header">
    <div class="shell nav">
      <a class="brand" href="#home" aria-label="الصفحة الرئيسية">
        <div class="mark"><span>U</span></div>
        <div><strong id="brandName">UCHIHA STORE</strong><small>DIGITAL MARKET</small></div>
      </a>
      <nav class="links" aria-label="التنقل الرئيسي">
        <a href="#home">الرئيسية</a><a href="#categories">الأقسام</a><a href="#products">المنتجات</a><a href="#how">طريقة الشراء</a><a href="#support">الدعم</a>
      </nav>
      <div class="actions">
        <select id="currency" class="control currency" aria-label="عملة العرض"><option>USD</option></select>
        <button id="themeToggle" class="control theme-button" type="button" aria-label="تبديل الوضع"><span id="themeIcon">☾</span> <span class="theme-label">الوضع</span></button>
        <button id="openCart" class="control cart-button" type="button" aria-label="فتح السلة"><span class="cart-label">السلة</span> 🛒<span id="cartCount" class="cart-count">0</span></button>
      </div>
    </div>
  </header>

  <main>
    <section class="hero" id="home">
      <div class="shell hero-grid">
        <div class="hero-copy">
          <span class="eyebrow"><span class="live-dot"></span> متجر رقمي متصل مباشرة بالبوت</span>
          <h1>كل ما تحتاجه من <span class="accent">المنتجات الرقمية</span> في مكان واحد.</h1>
          <p>تصفّح الأقسام والأسعار الحقيقية، اختر منتجك، وأكمل الدفع والتسليم بأمان داخل بوت UCHIHA.</p>
          <div class="hero-actions">
            <a class="primary" href="#products">ابدأ التسوق الآن</a>
            <button id="heroTelegram" class="secondary" type="button">فتح بوت المتجر ↗</button>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="visual-head"><b>UCHIHA LIVE STORE</b><span class="status"><span class="live-dot"></span> متصل</span></div>
          <div class="orbit"><div class="core">U</div><span class="floating f1">⚡ تسليم سريع</span><span class="floating f2">🛡️ دفع آمن</span><span class="floating f3">✦ أسعار محدثة</span></div>
          <div class="dashboard">
            <div class="metric"><b id="heroProducts">—</b><small>منتج متاح</small></div>
            <div class="metric"><b id="heroCategories">—</b><small>قسم رئيسي</small></div>
            <div class="metric"><b>24/7</b><small>استقبال الطلبات</small></div>
          </div>
        </div>
      </div>
      <div class="shell trust">
        <div class="trust-item"><span class="trust-icon">⚡</span><div><b>تنفيذ سريع</b><small>طلب مباشر عبر البوت</small></div></div>
        <div class="trust-item"><span class="trust-icon">🔄</span><div><b>كتالوج حي</b><small>أسعار ومخزون محدثان</small></div></div>
        <div class="trust-item"><span class="trust-icon">💳</span><div><b>خيارات دفع</b><small>طرق مرنة وآمنة</small></div></div>
        <div class="trust-item"><span class="trust-icon">💬</span><div><b>دعم مباشر</b><small>مساعدة عند الحاجة</small></div></div>
      </div>
    </section>

    <section class="section" id="categories">
      <div class="shell">
        <div class="section-head"><div><h2>استكشف الأقسام</h2><p>وصول سريع إلى أكثر الخدمات والمنتجات طلبًا</p></div><button id="showAllCategories" class="text-button" type="button">عرض جميع الأقسام</button></div>
        <div id="categoryGrid" class="category-grid"><div class="empty"><strong>جاري تحميل الأقسام...</strong></div></div>
      </div>
    </section>

    <section class="section" id="products">
      <div class="shell">
        <div class="section-head"><div><h2>المنتجات المتاحة</h2><p>اختر المنتج المناسب ثم أكمل طلبك عبر تيليجرام</p></div></div>
        <div class="catalog-panel">
          <div class="catalog-toolbar">
            <label class="search"><span>⌕</span><input id="searchInput" type="search" placeholder="ابحث عن لعبة، بطاقة، تطبيق أو خدمة..." autocomplete="off"></label>
            <select id="sortProducts" class="sort" aria-label="ترتيب المنتجات">
              <option value="default">الترتيب المقترح</option><option value="price-asc">السعر: الأقل أولًا</option><option value="price-desc">السعر: الأعلى أولًا</option><option value="name">حسب الاسم</option>
            </select>
            <div id="resultCount" class="result-count" aria-live="polite">جاري التحميل...</div>
          </div>
          <div id="productGrid" class="product-grid" aria-live="polite">
            <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
          </div>
          <div class="load-more"><button id="loadMore" class="secondary" type="button">عرض المزيد من المنتجات</button></div>
        </div>
      </div>
    </section>

    <section class="section" id="how">
      <div class="shell">
        <div class="section-head"><div><h2>كيف تشتري؟</h2><p>ثلاث خطوات بسيطة من الاختيار حتى استلام المنتج</p></div></div>
        <div class="steps">
          <article class="step"><span class="step-no">1</span><h3>اختر المنتج</h3><p>استخدم الأقسام أو البحث، وشاهد السعر والوصف ووقت التسليم.</p></article>
          <article class="step"><span class="step-no">2</span><h3>انتقل إلى البوت</h3><p>زر الشراء يفتح المنتج نفسه داخل بوت UCHIHA دون البحث عنه مجددًا.</p></article>
          <article class="step"><span class="step-no">3</span><h3>ادفع واستلم</h3><p>أكمل طريقة الدفع المناسبة، ثم تابع التسليم وحالة طلبك من حسابك.</p></article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="shell">
        <div class="section-head"><div><h2>الأسئلة الشائعة</h2><p>إجابات مختصرة قبل تنفيذ طلبك</p></div></div>
        <div class="faq">
          <details><summary>هل الأسعار في الموقع محدثة؟</summary><p>نعم، الموقع يقرأ المنتجات والأسعار والمخزون من قاعدة متجر UCHIHA مباشرة.</p></details>
          <details><summary>أين يتم الدفع واستلام المنتج؟</summary><p>يتم إكمال الطلب داخل بوت المتجر حتى تبقى عمليات الدفع والتسليم وحالة الطلب في مكان واحد.</p></details>
          <details><summary>هل أحتاج إلى إنشاء حساب جديد؟</summary><p>لا تحتاج إلى حساب منفصل للموقع؛ حساب تيليجرام الخاص بك هو حسابك داخل المتجر.</p></details>
          <details><summary>هل العملة المختارة تغيّر سعر الدفع؟</summary><p>العملات الإضافية للعرض والمقارنة، بينما يظهر السعر النهائي المعتمد داخل البوت قبل الدفع.</p></details>
        </div>
      </div>
    </section>

    <section class="section" id="support">
      <div class="shell cta">
        <div><h2>تحتاج إلى مساعدة؟</h2><p>فريق UCHIHA جاهز لمساعدتك في اختيار المنتج أو متابعة الطلب.</p></div>
        <button id="supportButton" class="primary" type="button">تواصل مع الدعم ↗</button>
      </div>
    </section>
  </main>

  <footer>
    <div class="shell footer-row">
      <div>© <span id="year"></span> <span id="footerName">UCHIHA STORE</span> — جميع الحقوق محفوظة.</div>
      <div class="footer-links"><a href="#products">المنتجات</a><a href="#how">طريقة الشراء</a><button id="footerSupport" class="text-button" type="button">الدعم</button></div>
    </div>
  </footer>

  <div id="overlay" class="overlay"></div>
  <aside id="cartDrawer" class="drawer" aria-hidden="true" aria-label="سلة المشتريات">
    <div class="drawer-head"><b>سلة المشتريات</b><button id="closeCart" class="ghost" type="button">إغلاق ✕</button></div>
    <div id="cartItems" class="drawer-body"></div>
    <div class="drawer-foot">
      <div class="total"><span>الإجمالي التقريبي</span><span id="cartTotal">0</span></div>
      <button id="checkout" class="primary wide" type="button">إكمال الطلب عبر تيليجرام</button>
      <p class="cart-note">سيُنسخ ملخص السلة ويُفتح بوت المتجر لإكمال الطلب بالسعر النهائي المعتمد.</p>
    </div>
  </aside>

  <section id="productModal" class="modal" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="modalTitle">
    <div class="modal-head"><b>تفاصيل المنتج</b><button id="closeModal" class="ghost" type="button">إغلاق ✕</button></div>
    <div class="modal-content">
      <div id="modalArt" class="modal-art">⚡</div>
      <div class="modal-copy"><div id="modalCategory" class="eyebrow">منتجات رقمية</div><h2 id="modalTitle">المنتج</h2><p id="modalDescription"></p><div id="modalPrice" class="modal-price"></div><div id="modalDelivery" class="availability"></div><div class="modal-actions"><button id="modalBuy" class="primary" type="button">شراء الآن</button><button id="modalAdd" class="secondary" type="button">أضف للسلة</button></div></div>
    </div>
  </section>

  <nav class="mobile-nav" aria-label="التنقل السريع">
    <a href="#home"><span>⌂</span>الرئيسية</a><a href="#categories"><span>▦</span>الأقسام</a><a href="#products"><span>⌕</span>البحث</a><button id="mobileCart" type="button"><span>🛒</span>السلة</button>
  </nav>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>

  <script>
  (function(){
    "use strict";
    var API="/v1/storefront/public-catalog";
    var fallbackStore={name:"UCHIHA STORE",currency:"USD",exchange_rates:{USD:1},telegram_url:"https://t.me/UchihaStoreBot",support_url:"",announcement:"منتجات رقمية أصلية وتسليم سريع عبر تيليجرام",accepting_orders:true};
    var state={
      store:fallbackStore,categories:[],products:[],cart:readCart(),category:"",query:"",
      page:1,pages:0,total:0,currency:storageGet("uchiha_currency")||"",
      sort:"default",allCategories:false,modalProduct:null,request:0
    };
    var searchTimer;
    var $=function(selector){return document.querySelector(selector)};
    var $$=function(selector){return Array.prototype.slice.call(document.querySelectorAll(selector))};

    function storageGet(key){try{return localStorage.getItem(key)||""}catch(_error){return ""}}
    function storageSet(key,value){try{localStorage.setItem(key,value)}catch(_error){}}
    function esc(value){
      return String(value==null?"":value).replace(/[&<>"']/g,function(char){
        return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];
      });
    }
    function readCart(){
      try{
        var parsed=JSON.parse(localStorage.getItem("uchiha_cart")||"[]");
        if(!Array.isArray(parsed))return [];
        return parsed.slice(0,30).map(function(item){
          return {id:Number(item.id)||0,name:String(item.name||"منتج"),price:Number(item.price)||0,qty:Math.max(1,Math.min(20,Number(item.qty)||1)),category_name:String(item.category_name||""),delivery_time:String(item.delivery_time||""),description:String(item.description||"")};
        }).filter(function(item){return item.id>0});
      }catch(_error){return []}
    }
    function safeUrl(value){
      try{
        var url=new URL(String(value||""));
        return url.protocol==="https:"?url.toString():"";
      }catch(_error){return ""}
    }
    function telegramUrl(productId){
      var base=safeUrl(state.store.telegram_url)||"https://t.me/UchihaStoreBot";
      try{
        var url=new URL(base);
        if(productId)url.searchParams.set("start","product_"+String(productId));
        return url.toString();
      }catch(_error){return base}
    }
    function supportUrl(){
      return safeUrl(state.store.support_url)||telegramUrl();
    }
    function toast(message){
      var element=$("#toast");
      element.textContent=message;
      element.classList.add("show");
      clearTimeout(toast.timer);
      toast.timer=setTimeout(function(){element.classList.remove("show")},2400);
    }
    function money(value){
      var rates=state.store.exchange_rates||{};
      var code=state.currency||state.store.currency||"USD";
      var rate=Number(rates[code]||1);
      var total=Number(value||0)*rate;
      try{return new Intl.NumberFormat("ar",{style:"currency",currency:code,maximumFractionDigits:2}).format(total)}
      catch(_error){return total.toFixed(2)+" "+code}
    }
    function categoryVisual(name){
      var text=String(name||"").toLowerCase();
      var rules=[
        [["لعب","game","pubg","free fire"],"🎮"],[["تطبيق","app","program"],"📱"],[["بطاق","card","gift"],"💳"],
        [["رصيد","عملات","currency"],"💱"],[["سوشل","social"],"📣"],[["انترنت","internet"],"🌐"],
        [["توثيق","verify"],"✅"],[["tv","تلفزيون"],"📺"],[["vpn"],"🛡️"],[["حساب","account"],"👤"],
        [["برمج","programming"],"💻"],[["أرقام","ارقام","number"],"🔢"],[["ذكاء","ai"],"🤖"],[["تصميم","design"],"🎨"],
        [["شحن","topup"],"⚡"],[["اشتراك","subscription"],"✦"]
      ];
      for(var i=0;i<rules.length;i++){
        for(var j=0;j<rules[i][0].length;j++)if(text.indexOf(rules[i][0][j])!==-1)return rules[i][1];
      }
      return "⚡";
    }
    function tone(seed){
      var tones=[
        ["#35141d","#17121a"],["#102f37","#10171d"],["#292041","#15131f"],["#163326","#111b17"],["#332710","#1b1810"],["#1a2940","#111720"]
      ];
      var text=String(seed||"U"),sum=0;
      for(var i=0;i<text.length;i++)sum+=text.charCodeAt(i);
      return tones[sum%tones.length];
    }
    function setStore(payload){
      state.store=Object.assign({},fallbackStore,payload||{});
      var name=state.store.name||"UCHIHA STORE";
      document.title=name+" | المتجر الرقمي";
      $("#brandName").textContent=name;
      $("#footerName").textContent=name;
      $("#announcementText").textContent=state.store.announcement||fallbackStore.announcement;
      renderCurrencies();
    }
    function renderCurrencies(){
      var rates=state.store.exchange_rates||{};
      var base=state.store.currency||"USD";
      var codes=Object.keys(rates).filter(function(code){return Number(rates[code])>0});
      if(codes.indexOf(base)===-1)codes.unshift(base);
      if(!codes.length)codes=[base];
      if(codes.indexOf(state.currency)===-1)state.currency=base;
      $("#currency").innerHTML=codes.map(function(code){return '<option value="'+esc(code)+'">'+esc(code)+"</option>"}).join("");
      $("#currency").value=state.currency;
    }
    function rootCategories(){
      return state.categories.filter(function(item){return !Number(item.parent_id||0)&&Number(item.product_count||0)>0});
    }
    function renderCategories(){
      var roots=rootCategories();
      $("#heroCategories").textContent=String(roots.length);
      var visible=state.allCategories?roots:roots.slice(0,10);
      var allCard={id:"",name:"كل المنتجات",product_count:state.total};
      var list=[allCard].concat(visible);
      $("#categoryGrid").innerHTML=list.map(function(item,index){
        var active=String(state.category)===String(item.id)?" active":"";
        var glow=["rgba(239,51,75,.22)","rgba(47,164,255,.20)","rgba(130,92,255,.20)","rgba(66,211,146,.18)","rgba(255,189,89,.18)"][index%5];
        return '<button class="category-card'+active+'" type="button" data-action="category" data-id="'+esc(item.id)+'" style="--glow:'+glow+'"><span class="category-icon">'+categoryVisual(item.name)+'</span><b>'+esc(item.name)+'</b><small>'+Number(item.product_count||0)+" منتج</small></button>";
      }).join("")||'<div class="empty"><strong>لا توجد أقسام متاحة حاليًا</strong>ستظهر الأقسام هنا فور مزامنة المنتجات.</div>';
      $("#showAllCategories").style.display=roots.length>10?"inline-block":"none";
      $("#showAllCategories").textContent=state.allCategories?"عرض الأقسام الأساسية":"عرض جميع الأقسام";
    }
    function sortedProducts(){
      var items=state.products.slice();
      if(state.sort==="price-asc")items.sort(function(a,b){return Number(a.price)-Number(b.price)});
      if(state.sort==="price-desc")items.sort(function(a,b){return Number(b.price)-Number(a.price)});
      if(state.sort==="name")items.sort(function(a,b){return String(a.name).localeCompare(String(b.name),"ar")});
      return items;
    }
    function productCard(product){
      var colors=tone(product.category_name||product.name);
      var available=product.available&&state.store.accepting_orders;
      return '<article class="product-card">'+
        '<button class="product-visual" type="button" data-action="quick" data-id="'+Number(product.id)+'" style="--tone-a:'+colors[0]+';--tone-b:'+colors[1]+'" aria-label="عرض تفاصيل '+esc(product.name)+'">'+
          '<span class="product-tag">'+esc(product.category_name||"منتجات رقمية")+'</span><span class="product-emoji">'+categoryVisual((product.category_name||"")+" "+(product.name||""))+'</span>'+
        '</button>'+
        '<div class="product-body"><h3>'+esc(product.name)+'</h3><div class="product-desc">'+esc(product.description||"منتج رقمي متوفر عبر UCHIHA STORE.")+'</div>'+
          '<span class="availability">'+(available?"متوفر الآن":"غير متاح حاليًا")+'</span>'+
          '<div class="price-row"><div><div class="price">'+esc(money(product.price))+'</div><div class="delivery">'+esc(product.delivery_time||"تسليم حسب تفاصيل المنتج")+'</div></div></div>'+
          '<div class="card-actions"><button class="buy" type="button" data-action="buy" data-id="'+Number(product.id)+'" '+(available?"":"disabled")+'>شراء الآن</button><button class="quick" type="button" data-action="add" data-id="'+Number(product.id)+'" aria-label="إضافة للسلة">＋</button></div>'+
        '</div></article>';
    }
    function renderProducts(){
      var grid=$("#productGrid");
      var items=sortedProducts();
      if(!items.length){
        grid.innerHTML='<div class="empty"><strong>لم نجد منتجات مطابقة</strong>جرّب كلمة بحث أخرى أو اختر قسمًا مختلفًا.</div>';
      }else{
        grid.innerHTML=items.map(productCard).join("");
      }
      $("#resultCount").textContent=state.total+" منتج";
      $("#heroProducts").textContent=String(state.total);
      $("#loadMore").style.display=state.page<state.pages?"inline-block":"none";
    }
    function loading(){
      $("#productGrid").innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
      $("#resultCount").textContent="جاري التحميل...";
      $("#loadMore").style.display="none";
    }
    async function loadCatalog(append){
      var request=++state.request;
      if(!append){state.page=1;loading()}
      var params=new URLSearchParams({page:String(state.page),limit:"24"});
      if(state.category)params.set("category_id",String(state.category));
      if(state.query)params.set("q",state.query);
      try{
        var response=await fetch(API+"?"+params.toString(),{headers:{Accept:"application/json"}});
        if(!response.ok)throw new Error("catalog");
        var data=await response.json();
        if(request!==state.request)return;
        setStore(data.store||{});
        state.categories=Array.isArray(data.categories)?data.categories:[];
        var productData=data.products||{};
        var batch=Array.isArray(productData.items)?productData.items:[];
        state.pages=Number(productData.pages||0);
        state.total=Number(productData.total||0);
        state.products=append?state.products.concat(batch):batch;
        renderCategories();
        renderProducts();
        renderCart();
      }catch(_error){
        if(request!==state.request)return;
        $("#productGrid").innerHTML='<div class="empty"><strong>تعذر تحميل المتجر الآن</strong><button class="secondary" type="button" data-action="retry">إعادة المحاولة</button></div>';
        $("#resultCount").textContent="غير متصل";
        $("#loadMore").style.display="none";
      }
    }
    function findProduct(id){
      for(var i=0;i<state.products.length;i++)if(Number(state.products[i].id)===Number(id))return state.products[i];
      for(var j=0;j<state.cart.length;j++)if(Number(state.cart[j].id)===Number(id))return state.cart[j];
      return null;
    }
    function saveCart(){
      storageSet("uchiha_cart",JSON.stringify(state.cart));
      renderCart();
    }
    function addCart(product){
      if(!product)return;
      var existing=null;
      for(var i=0;i<state.cart.length;i++)if(Number(state.cart[i].id)===Number(product.id))existing=state.cart[i];
      if(existing)existing.qty=Math.min(20,Number(existing.qty||1)+1);
      else state.cart.push({id:Number(product.id),name:String(product.name),price:Number(product.price||0),qty:1,category_name:String(product.category_name||""),delivery_time:String(product.delivery_time||""),description:String(product.description||"")});
      saveCart();
      toast("تمت إضافة المنتج إلى السلة");
    }
    function changeQty(id,delta){
      var item=null;
      for(var i=0;i<state.cart.length;i++)if(Number(state.cart[i].id)===Number(id))item=state.cart[i];
      if(!item)return;
      item.qty=Math.max(1,Math.min(20,Number(item.qty||1)+delta));
      saveCart();
    }
    function removeCart(id){
      state.cart=state.cart.filter(function(item){return Number(item.id)!==Number(id)});
      saveCart();
      toast("تم حذف المنتج من السلة");
    }
    function cartTotal(){
      return state.cart.reduce(function(sum,item){return sum+Number(item.price||0)*Number(item.qty||1)},0);
    }
    function renderCart(){
      var count=state.cart.reduce(function(sum,item){return sum+Number(item.qty||1)},0);
      $("#cartCount").textContent=String(count);
      $("#cartTotal").textContent=money(cartTotal());
      $("#cartItems").innerHTML=state.cart.length?state.cart.map(function(item){
        return '<div class="cart-item"><div><b>'+esc(item.name)+'</b><small>'+esc(money(item.price))+" × "+Number(item.qty)+'</small><div class="qty"><button type="button" data-action="qty-minus" data-id="'+Number(item.id)+'">−</button><span>'+Number(item.qty)+'</span><button type="button" data-action="qty-plus" data-id="'+Number(item.id)+'">＋</button></div></div><button class="remove" type="button" data-action="remove" data-id="'+Number(item.id)+'">حذف</button></div>';
      }).join(""):'<div class="empty"><strong>السلة فارغة</strong>أضف منتجًا وسيظهر هنا.</div>';
    }
    function setOverlay(){
      var open=$("#cartDrawer").classList.contains("show")||$("#productModal").classList.contains("show");
      $("#overlay").classList.toggle("show",open);
      document.body.classList.toggle("locked",open);
    }
    function openCart(){
      closeModal();
      $("#cartDrawer").classList.add("show");
      $("#cartDrawer").setAttribute("aria-hidden","false");
      setOverlay();
    }
    function closeCart(){
      $("#cartDrawer").classList.remove("show");
      $("#cartDrawer").setAttribute("aria-hidden","true");
      setOverlay();
    }
    function openModal(product){
      if(!product)return;
      closeCart();
      state.modalProduct=product;
      $("#modalTitle").textContent=product.name;
      $("#modalCategory").textContent=product.category_name||"منتجات رقمية";
      $("#modalDescription").textContent=product.description||"منتج رقمي متوفر عبر UCHIHA STORE.";
      $("#modalPrice").textContent=money(product.price);
      $("#modalDelivery").textContent=product.delivery_time||"متوفر الآن";
      $("#modalArt").textContent=categoryVisual((product.category_name||"")+" "+(product.name||""));
      $("#modalBuy").disabled=!(product.available!==false&&state.store.accepting_orders);
      $("#productModal").classList.add("show");
      $("#productModal").setAttribute("aria-hidden","false");
      setOverlay();
    }
    function closeModal(){
      $("#productModal").classList.remove("show");
      $("#productModal").setAttribute("aria-hidden","true");
      state.modalProduct=null;
      setOverlay();
    }
    function buyProduct(product){
      if(!product)return;
      window.open(telegramUrl(product.id),"_blank","noopener");
    }
    function checkout(){
      if(!state.cart.length){toast("أضف منتجًا إلى السلة أولًا");return}
      var lines=["طلب جديد من موقع "+state.store.name,""];
      state.cart.forEach(function(item,index){lines.push((index+1)+". "+item.name+" × "+item.qty)});
      lines.push("","الإجمالي التقريبي: "+money(cartTotal()));
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(lines.join("\n")).catch(function(){});
      var direct=state.cart.length===1?telegramUrl(state.cart[0].id):telegramUrl();
      window.open(direct,"_blank","noopener");
      toast(state.cart.length===1?"تم فتح المنتج داخل البوت":"تم نسخ ملخص السلة وفتح البوت");
    }
    function openSupport(){window.open(supportUrl(),"_blank","noopener")}
    function applyTheme(theme){
      document.documentElement.setAttribute("data-theme",theme);
      storageSet("uchiha_theme",theme);
      $("#themeIcon").textContent=theme==="dark"?"☾":"☀";
      var meta=document.querySelector('meta[name="theme-color"]');
      if(meta)meta.setAttribute("content",theme==="dark"?"#08090d":"#f4f5f8");
    }

    document.addEventListener("click",function(event){
      var target=event.target.closest("[data-action]");
      if(!target)return;
      var action=target.getAttribute("data-action");
      var id=Number(target.getAttribute("data-id")||0);
      if(action==="category"){state.category=target.getAttribute("data-id")||"";state.page=1;loadCatalog(false);document.querySelector("#products").scrollIntoView()}
      if(action==="quick")openModal(findProduct(id));
      if(action==="buy")buyProduct(findProduct(id));
      if(action==="add")addCart(findProduct(id));
      if(action==="remove")removeCart(id);
      if(action==="qty-minus")changeQty(id,-1);
      if(action==="qty-plus")changeQty(id,1);
      if(action==="retry")loadCatalog(false);
    });
    $("#searchInput").addEventListener("input",function(event){
      clearTimeout(searchTimer);
      searchTimer=setTimeout(function(){state.query=event.target.value.trim().slice(0,100);loadCatalog(false)},350);
    });
    $("#sortProducts").addEventListener("change",function(event){state.sort=event.target.value;renderProducts()});
    $("#currency").addEventListener("change",function(event){state.currency=event.target.value;storageSet("uchiha_currency",state.currency);renderProducts();renderCart();if(state.modalProduct)openModal(state.modalProduct)});
    $("#showAllCategories").addEventListener("click",function(){state.allCategories=!state.allCategories;renderCategories()});
    $("#openCart").addEventListener("click",openCart);$("#mobileCart").addEventListener("click",openCart);$("#closeCart").addEventListener("click",closeCart);
    $("#closeModal").addEventListener("click",closeModal);$("#overlay").addEventListener("click",function(){closeCart();closeModal()});
    $("#checkout").addEventListener("click",checkout);$("#heroTelegram").addEventListener("click",function(){window.open(telegramUrl(),"_blank","noopener")});
    $("#supportButton").addEventListener("click",openSupport);$("#footerSupport").addEventListener("click",openSupport);
    $("#modalBuy").addEventListener("click",function(){buyProduct(state.modalProduct)});$("#modalAdd").addEventListener("click",function(){addCart(state.modalProduct)});
    $("#loadMore").addEventListener("click",function(){if(state.page<state.pages){state.page+=1;loadCatalog(true)}});
    $("#themeToggle").addEventListener("click",function(){applyTheme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark")});
    document.addEventListener("keydown",function(event){if(event.key==="Escape"){closeCart();closeModal()}});

    $("#year").textContent=String(new Date().getFullYear());
    applyTheme(storageGet("uchiha_theme")==="light"?"light":"dark");
    renderCart();
    loadCatalog(false);
  })();
  </script>
</body>
</html>"""
