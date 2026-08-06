"""Refine the Sharingan loader and responsive category grids."""
from __future__ import annotations

import re
from typing import Any


REFINEMENT_CSS = r"""
    /* Loader v2: small, transparent, eye-first and smooth from a visible closed state. */
    .uchiha-loader{padding:12px;background:transparent;transition:opacity .2s ease,visibility .2s ease}
    .uchiha-loader-backdrop{background:rgba(0,0,0,.14);backdrop-filter:blur(1.5px)}
    .uchiha-loader-panel{width:150px;min-height:116px;padding:8px 10px;border:0;border-radius:0;background:transparent;box-shadow:none;overflow:visible}
    .uchiha-loader-panel:before,.uchiha-loader-title,.uchiha-loader-text,.uchiha-loader-dots{display:none!important}
    .uchiha-loader-emblem{width:122px;height:96px;margin:0}
    .uchiha-loader-ring{width:112px;height:112px;background:conic-gradient(from 0deg,transparent 0 20%,rgba(var(--primary-rgb),.16) 28%,rgba(255,83,98,.86) 48%,rgba(var(--primary-rgb),.24) 65%,transparent 82%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 0);filter:drop-shadow(0 0 7px rgba(var(--primary-rgb),.22));animation-duration:1.05s}
    .uchiha-loader-ring:after{inset:9px;border-color:rgba(var(--primary-rgb),.08)}
    .uchiha-eye-wrap{width:106px;height:62px;filter:drop-shadow(0 7px 14px rgba(0,0,0,.45)) drop-shadow(0 0 8px rgba(var(--primary-rgb),.18))}
    .uchiha-eye-aperture{width:106px;height:58px;clip-path:inset(49% 0 49% 0 round 50%);animation:none!important;will-change:clip-path}
    .uchiha-eye-svg{width:106px;height:58px;filter:none;transform:none!important;animation:none!important}
    .uchiha-eye-closed-line{width:85px;height:1.5px;opacity:1;background:linear-gradient(90deg,transparent,rgba(127,16,28,.92) 17%,#ef5362 50%,rgba(127,16,28,.92) 83%,transparent);box-shadow:0 0 7px rgba(var(--primary-rgb),.28);animation:none!important}
    .uchiha-loader.show .uchiha-eye-aperture{animation:uchihaRefinedEyeOpen 4.2s cubic-bezier(.18,.74,.2,1) forwards!important}
    .uchiha-loader.show .uchiha-eye-closed-line{animation:uchihaRefinedClosedFade 1.55s .08s ease forwards!important}
    .uchiha-loader.is-closing .uchiha-eye-aperture{animation:uchihaRefinedEyeClose .22s ease forwards!important}
    .uchiha-loader.is-closing .uchiha-eye-closed-line{animation:none!important;opacity:.6}
    @keyframes uchihaRefinedEyeOpen{0%{clip-path:inset(49% 0 49% 0 round 50%)}18%{clip-path:inset(39% 0 39% 0 round 50%)}43%{clip-path:inset(22% 0 22% 0 round 48%)}68%{clip-path:inset(12% 0 12% 0 round 46%)}86%{clip-path:inset(7% 0 7% 0 round 45%)}100%{clip-path:inset(4% 0 4% 0 round 44%)}}
    @keyframes uchihaRefinedEyeClose{to{clip-path:inset(49% 0 49% 0 round 50%)}}
    @keyframes uchihaRefinedClosedFade{0%,34%{opacity:1}72%{opacity:.42}100%{opacity:0}}
    .uchiha-blood-tear{top:45px;width:3px;filter:drop-shadow(0 2px 2px rgba(90,0,8,.34));background:linear-gradient(#a9091a,#520006)}
    .uchiha-blood-tear.one{right:34px}.uchiha-blood-tear.two{right:45px;width:2px}
    .uchiha-loader.is-blood .uchiha-blood-tear.one{animation:uchihaRefinedBlood 2.9s ease-in infinite}.uchiha-loader.is-blood .uchiha-blood-tear.two{animation:uchihaRefinedBlood 3.35s .85s ease-in infinite}
    @keyframes uchihaRefinedBlood{0%{height:0;opacity:0;transform:translateY(-1px)}14%{opacity:.8}58%{height:19px;opacity:.78}84%{height:28px;opacity:.45;transform:translateY(4px)}100%{height:31px;opacity:0;transform:translateY(8px)}}

    /* Main categories are large (2/3 columns); nested categories are denser (3/4). */
    .category-grid.uchiha-root-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .category-grid.uchiha-root-grid .category-card{border-radius:23px;box-shadow:0 15px 34px rgba(0,0,0,.22)}
    .category-grid.uchiha-root-grid .category-img{aspect-ratio:4/3}
    .category-grid.uchiha-root-grid .category-name{padding:13px 12px 8px;font-size:13px}
    .category-grid.uchiha-root-grid .category-summary{padding:0 12px 13px;font-size:8px}
    .category-grid.uchiha-root-grid .category-icon{right:10px;bottom:47px;width:39px;height:39px}
    .category-grid.uchiha-sub-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .category-grid.uchiha-sub-grid .category-card{border-radius:17px}
    .category-grid.uchiha-sub-grid .category-img{aspect-ratio:1/1}
    .category-grid.uchiha-sub-grid .category-name{padding:9px 8px 5px;font-size:10px}
    .category-grid.uchiha-sub-grid .category-summary{padding:0 8px 9px;font-size:7px;gap:3px}.category-grid.uchiha-sub-grid .category-summary b{font-size:7px}
    .category-grid.uchiha-sub-grid .category-count{top:6px;left:6px;padding:4px 5px;font-size:7px}
    .category-grid.uchiha-sub-grid .category-badge{right:6px;top:6px;padding:4px 5px;font-size:7px}
    .category-grid.uchiha-sub-grid .category-icon{right:7px;bottom:31px;width:27px;height:27px;padding:3px;border-radius:9px}
    @media(min-width:620px){.category-grid.uchiha-root-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.category-grid.uchiha-sub-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}}
    @media(max-width:350px){.category-grid.uchiha-sub-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(prefers-reduced-motion:reduce){.uchiha-loader.show .uchiha-eye-aperture{animation:none!important;clip-path:inset(4% 0 4% 0 round 44%)}.uchiha-loader.show .uchiha-eye-closed-line{display:none}.uchiha-loader-ring{animation-duration:1.8s}}
"""


REFINED_EYE_SVG = r'''<svg class="uchiha-eye-svg" viewBox="0 0 180 96" focusable="false" aria-hidden="true">
              <defs>
                <radialGradient id="uchihaRefinedIris" cx="47%" cy="42%" r="58%"><stop offset="0" stop-color="#ff8b92"/><stop offset=".34" stop-color="#ec3442"/><stop offset=".72" stop-color="#9d0b18"/><stop offset="1" stop-color="#4d0208"/></radialGradient>
                <linearGradient id="uchihaRefinedSclera" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffdfd"/><stop offset=".62" stop-color="#eee8e9"/><stop offset="1" stop-color="#cfc4c7"/></linearGradient>
              </defs>
              <path d="M5 48C25 19 55 8 89 8c37 0 67 13 86 40-20 27-50 40-86 40C54 88 24 75 5 48Z" fill="url(#uchihaRefinedSclera)" stroke="#211317" stroke-width="4.2" stroke-linejoin="round"/>
              <path d="M8 47C31 22 58 13 89 13c34 0 61 11 83 34" fill="none" stroke="#10090b" stroke-width="5" stroke-linecap="round"/>
              <path d="M9 50c22 23 49 33 80 33 34 0 61-11 82-34" fill="none" stroke="#6d343c" stroke-width="2.3" stroke-linecap="round" opacity=".75"/>
              <path d="M5 48c5-5 10-8 17-10M175 48c-5-5-10-8-17-10" fill="none" stroke="#8b535a" stroke-width="2" stroke-linecap="round" opacity=".68"/>
              <circle cx="90" cy="48" r="31" fill="url(#uchihaRefinedIris)" stroke="#3b0208" stroke-width="3.2"/>
              <circle cx="90" cy="48" r="20" fill="none" stroke="#260106" stroke-width="2.2" opacity=".76"/>
              <g fill="#130104">
                <circle cx="90" cy="48" r="8.5"/>
                <g transform="rotate(0 90 48)"><circle cx="90" cy="24.5" r="5"/><path d="M94 21c8 2 12 8 12 14-4-4-9-6-14-5Z"/></g>
                <g transform="rotate(120 90 48)"><circle cx="90" cy="24.5" r="5"/><path d="M94 21c8 2 12 8 12 14-4-4-9-6-14-5Z"/></g>
                <g transform="rotate(240 90 48)"><circle cx="90" cy="24.5" r="5"/><path d="M94 21c8 2 12 8 12 14-4-4-9-6-14-5Z"/></g>
              </g>
              <ellipse cx="79" cy="35" rx="5" ry="3" fill="#fff" opacity=".38"/>
            </svg>'''


REFINEMENT_JS = r'''
  function applyUchihaCategoryDensity(){
    const grid=$('#categoryGrid');if(!grid)return;
    const nested=Boolean(state.category);
    grid.classList.toggle('uchiha-root-grid',!nested);
    grid.classList.toggle('uchiha-sub-grid',nested);
  }
  const uchihaRefinedRenderCategories=renderCategories;
  renderCategories=function(){const result=uchihaRefinedRenderCategories();applyUchihaCategoryDensity();return result};
  applyUchihaCategoryDensity();
'''


def _inject_before_once(document: str, marker: str, content: str, name: str) -> str:
    if marker not in document:
        raise RuntimeError(f"{name} marker was not found")
    return document.replace(marker, content + marker, 1)


def patch_storefront_html(document: str) -> str:
    if "uchihaRefinedEyeOpen" in document:
        return document
    if 'id="uchihaLoader"' not in document:
        raise RuntimeError("The base Uchiha loader must be installed first")
    document, count = re.subn(
        r'<svg class="uchiha-eye-svg".*?</svg>',
        REFINED_EYE_SVG,
        document,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        raise RuntimeError("Sharingan SVG marker was not found")
    document = _inject_before_once(document, "  </style>", REFINEMENT_CSS + "\n", "Customer style")
    document = _inject_before_once(document, "  boot();\n  </script>", REFINEMENT_JS + "\n", "Customer boot")
    return document


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_visual_refinement_installed", False):
        return
    import storefront_theme
    from storefront_uchiha_v2 import patch_storefront_html as patch_uchiha_v2

    customer = patch_storefront_html(api_module._STOREFRONT_HTML)
    customer = patch_uchiha_v2(customer)
    api_module._STOREFRONT_HTML = customer
    storefront_theme.STOREFRONT_HTML = customer
    api_module._storefront_visual_refinement_installed = True


__all__ = ["install", "patch_storefront_html"]