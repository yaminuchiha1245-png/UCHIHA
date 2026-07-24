"""Customer storefront HTML patch for owner branding and policies."""
from __future__ import annotations

def patch_storefront_html(document: str) -> str:
    if "uchiha-policy-links" in document:
        return document
    document = document.replace('href="/manifest.webmanifest"', 'href="/manifest-dynamic.webmanifest"')
    document = document.replace('href="/app-icon.svg"', 'href="/v1/storefront/branding/icon"')
    document = document.replace('src="/app-icon.svg"', 'src="/v1/storefront/branding/icon"')
    css = """
    .uchiha-policy-links{width:min(1180px,calc(100% - 28px));margin:18px auto 95px;padding:15px 18px;border:1px solid rgba(228,49,63,.14);border-radius:16px;background:rgba(18,18,24,.75);display:flex;justify-content:center;gap:18px;flex-wrap:wrap}
    .uchiha-policy-links img{width:150px;height:42px;object-fit:contain}.uchiha-policy-links a{color:#bdb5b8;font-size:11px;text-decoration:none}.uchiha-policy-links a:hover{color:#ff7b86}
    """
    if "</style>" in document:
        document = document.replace("</style>", css + "</style>", 1)
    links = """<nav class="uchiha-policy-links" aria-label="سياسات المتجر">
      <img src="/v1/storefront/branding/logo" alt="Uchiha Store">
      <a href="/policies/privacy">سياسة الخصوصية</a>
      <a href="/policies/terms">الشروط والأحكام</a>
      <a href="/policies/refund">سياسة الاسترجاع</a>
    </nav>"""
    return document.replace("</body>", links + "</body>", 1)
